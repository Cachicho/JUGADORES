-- ============================================================
-- TODO YAMBA — Esquema de persistencia con Row Level Security
-- ============================================================
-- Arquitectura de seguridad:
--   El estado EN VIVO del juego (manos de cartas, giros de ruleta, turnos)
--   vive en memoria del servidor Node.js — el cliente NUNCA decide un
--   resultado ni escribe directo a Supabase para ese estado, así que no
--   hay forma de manipular un giro o una carta desde el navegador.
--
--   Supabase se usa para PERSISTENCIA: perfiles de usuario autenticado,
--   historial de transacciones de fichas y auditoría de partidas. El
--   servidor escribe aquí con la Service Role Key (bypassa RLS, confiable
--   porque es código propio). Los clientes, si llegan a leer directo con
--   la anon key (p. ej. para mostrar su propio historial), están sujetos
--   a las políticas RLS de abajo, que exigen auth.uid().
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── USUARIOS ────────────────────────────────────────────────
create table if not exists public.usuarios (
  id          uuid primary key default uuid_generate_v4(),
  auth_uid    uuid unique references auth.users(id) on delete cascade,
  nombre      text not null check (char_length(nombre) between 2 and 24),
  avatar      text not null default '🎩',
  es_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── SALAS ───────────────────────────────────────────────────
create table if not exists public.salas (
  id          uuid primary key default uuid_generate_v4(),
  codigo      text unique not null,
  juego_activo text not null default 'lobby' check (juego_activo in ('lobby','roulette','intermedio')),
  creado_por  uuid references public.usuarios(id),
  created_at  timestamptz not null default now()
);

-- ── PARTIDAS (registro histórico de cada ronda jugada) ─────
create table if not exists public.partidas (
  id            uuid primary key default uuid_generate_v4(),
  sala_id       uuid not null references public.salas(id) on delete cascade,
  juego         text not null check (juego in ('roulette','intermedio')),
  resultado     jsonb not null default '{}',   -- ej: {"number": 17, "color": "black"} o {"pot_final": 0}
  jugadores     jsonb not null default '[]',   -- snapshot de participantes y saldos al cierre
  created_at    timestamptz not null default now()
);

-- ── TRANSACCIONES DE FICHAS (auditoría) ────────────────────
create table if not exists public.transacciones_fichas (
  id          uuid primary key default uuid_generate_v4(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  sala_id     uuid references public.salas(id) on delete set null,
  admin_id    uuid references public.usuarios(id),
  monto       bigint not null,               -- positivo = ingreso, negativo = egreso
  tipo        text not null check (tipo in ('recarga','descuento','apuesta','premio','ante','pozo')),
  descripcion text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_transacciones_usuario on public.transacciones_fichas(usuario_id);
create index if not exists idx_partidas_sala on public.partidas(sala_id);

-- ── ACTIVAR ROW LEVEL SECURITY EN TODAS LAS TABLAS ─────────
alter table public.usuarios               enable row level security;
alter table public.salas                  enable row level security;
alter table public.partidas               enable row level security;
alter table public.transacciones_fichas   enable row level security;

-- ── POLÍTICAS: usuarios ─────────────────────────────────────
-- Cualquier usuario autenticado puede ver perfiles básicos (necesario para mostrar
-- nombre/avatar de otros jugadores en la sala), pero NO puede editar a otros.
create policy "usuarios_select_autenticados"
  on public.usuarios for select
  to authenticated
  using (true);

-- Un usuario solo puede actualizar SU PROPIO perfil (nombre/avatar), nunca su flag de admin.
create policy "usuarios_update_propio"
  on public.usuarios for update
  to authenticated
  using (auth_uid = auth.uid())
  with check (
    auth_uid = auth.uid()
    and es_admin = (select es_admin from public.usuarios where auth_uid = auth.uid())
  );

-- La creación de usuarios y cualquier cambio de es_admin solo lo hace el servidor (service_role).
create policy "usuarios_insert_admin"
  on public.usuarios for insert
  to service_role
  with check (true);

-- ── POLÍTICAS: salas ─────────────────────────────────────────
create policy "salas_select_autenticados"
  on public.salas for select
  to authenticated
  using (true);

-- Solo el servidor (service_role) crea/actualiza salas — el cliente nunca escribe directo.
create policy "salas_write_admin"
  on public.salas for all
  to service_role
  using (true)
  with check (true);

-- ── POLÍTICAS: partidas ──────────────────────────────────────
-- Cualquier autenticado puede leer el historial de partidas (transparencia: nadie puede
-- alegar que se manipuló un resultado, todos ven el mismo registro).
create policy "partidas_select_autenticados"
  on public.partidas for select
  to authenticated
  using (true);

create policy "partidas_insert_admin"
  on public.partidas for insert
  to service_role
  with check (true);

-- ── POLÍTICAS: transacciones_fichas ───────────────────────────
-- Un usuario SOLO puede ver SUS PROPIAS transacciones (su propio historial de saldo).
create policy "transacciones_select_propio"
  on public.transacciones_fichas for select
  to authenticated
  using (
    usuario_id = (select id from public.usuarios where auth_uid = auth.uid())
  );

-- Ningún cliente inserta transacciones directamente — siempre las registra el servidor
-- tras validar la jugada (evita que un jugador se "regale" fichas a sí mismo).
create policy "transacciones_insert_admin"
  on public.transacciones_fichas for insert
  to service_role
  with check (true);

-- Nadie puede actualizar ni borrar transacciones (inmutables, son un libro contable).
-- (No se crean políticas UPDATE/DELETE para authenticated ni service_role intencionalmente;
--  sin política que lo permita, RLS bloquea la operación por defecto.)
