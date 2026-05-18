'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/shared/Icon';
import { Toast } from '@/components/shared/Toast';
import { sendMagicLink, signInWithPassword } from '@/app/actions/auth';

type Mode = 'password' | 'magic';
type Notice = { tone: 'error' | 'success'; text: string };

const MODE_LABELS: Record<Mode, string> = {
  password: 'Tengo cuenta',
  magic: 'Es mi primera vez'
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingForm, startForm] = useTransition();
  const [msg, setMsg] = useState<Notice | null>(null);
  const [mode, setMode] = useState<Mode>('password');
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [sentName, setSentName] = useState<string>('');

  // `?next=` que vino en el URL (ej: /[slug]/reservar manda acá si no hay sesión).
  // Se reenvía como hidden input al action y al link de registro.
  const next = searchParams.get('next') || '';
  const shopParam = searchParams.get('shop') || '';

  // Banner de éxito al volver desde el flow de actualización de password.
  useEffect(() => {
    if (searchParams.get('reset') === '1') {
      setMsg({ tone: 'success', text: 'Contraseña actualizada. Iniciá sesión con la nueva.' });
    }
  }, [searchParams]);

  if (sentToEmail) {
    return (
      <MagicLinkSentScreen
        email={sentToEmail}
        onResend={() => {
          const fd = new FormData();
          fd.set('name', sentName || 'Usuario');
          fd.set('email', sentToEmail);
          return new Promise<{ error?: string }>((resolve) => {
            startForm(async () => {
              const res = await sendMagicLink(fd);
              resolve(res || {});
            });
          });
        }}
        resending={pendingForm}
        onUseOtherEmail={() => { setSentToEmail(null); setMsg(null); }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-ink text-bg relative overflow-hidden">
      <div className="absolute -top-[120px] -right-[80px] w-[360px] h-[360px] rounded-full border border-dark-line" aria-hidden="true" />
      <div className="absolute -top-[60px] -right-[20px] w-[240px] h-[240px] rounded-full border border-dark-line" aria-hidden="true" />

      <div className="relative flex flex-col px-6 pt-6 pb-8 min-h-screen">
        <div className="mt-7 relative">
          <div className="font-mono text-[10px] tracking-[3px] text-dark-muted mb-2.5">SAAS · BARBERÍAS</div>
          <h1 className="font-display text-[56px] leading-[0.95] -tracking-[1px]">Turnos<br/>Barbería</h1>
          <div className="mt-3 text-[13px] text-dark-muted max-w-[280px]">
            {mode === 'password'
              ? <>Iniciá sesión con tu <span className="italic text-accent">email y contraseña.</span></>
              : <>Reservaste sin crear cuenta antes? Te mandamos un <span className="italic text-accent">link mágico</span> al email para entrar.</>}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-2 bg-dark-card border border-dark-line rounded-xl p-1">
          {(['password', 'magic'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setMsg(null); }}
              aria-pressed={mode === m}
              className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-medium transition ${
                mode === m ? 'bg-bg text-ink' : 'text-dark-muted hover:text-bg'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {mode === 'password' ? (
          <PasswordForm
            pending={pendingForm}
            msg={msg}
            next={next}
            onSubmit={(fd) => startForm(async () => {
              setMsg(null);
              if (next) fd.set('next', next);
              const res = await signInWithPassword(fd);
              if (res?.error) setMsg({ tone: 'error', text: res.error });
              else router.push(res?.dest || '/');
            })}
            onClearMsg={() => setMsg(null)}
          />
        ) : (
          <MagicForm
            pending={pendingForm}
            msg={msg}
            next={next}
            onSubmit={(fd) => startForm(async () => {
              setMsg(null);
              const nameVal = String(fd.get('name') || '');
              const emailVal = String(fd.get('email') || '');
              if (next) fd.set('next', next);
              const res = await sendMagicLink(fd);
              if (res?.error) setMsg({ tone: 'error', text: res.error });
              else {
                setSentName(nameVal);
                setSentToEmail(emailVal);
              }
            })}
            onClearMsg={() => setMsg(null)}
          />
        )}

        <div className="flex-1 min-h-[16px]" />

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={`/registro${(() => {
              const sp = new URLSearchParams();
              if (next) sp.set('next', next);
              if (shopParam) sp.set('shop', shopParam);
              const qs = sp.toString();
              return qs ? `?${qs}` : '';
            })()}`}
            className="text-[13px] text-dark-muted underline underline-offset-4 hover:text-bg transition text-center"
          >
            ¿No tenés cuenta? Registrate <Icon name="arrow-right" size={12} color="#8C8A83" />
          </Link>
        </div>
      </div>
    </main>
  );
}

function PasswordForm({
  pending, msg, onSubmit, onClearMsg, next
}: {
  pending: boolean;
  msg: Notice | null;
  onSubmit: (fd: FormData) => void;
  onClearMsg: () => void;
  next: string;
}) {
  return (
    <div className="mt-4">
      <form className="flex flex-col gap-3" action={onSubmit}>
        {next && <input type="hidden" name="next" value={next} />}
        <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line block focus-within:border-accent transition">
          <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            placeholder="vos@email.com"
            className="bg-transparent text-bg text-[16px] w-full outline-none font-mono placeholder:text-dark-muted/60"
          />
        </label>
        <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line block focus-within:border-accent transition">
          <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">Contraseña</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            enterKeyHint="send"
            placeholder="••••••••"
            className="bg-transparent text-bg text-[16px] w-full outline-none font-mono placeholder:text-dark-muted/60"
          />
        </label>

        {msg && (
          <Toast
            dark
            tone={msg.tone}
            message={msg.text}
            onClose={onClearMsg}
            autoDismissMs={5000}
          />
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white border-0 px-4 py-3.5 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 tracking-wide disabled:opacity-60 active:scale-[0.98] transition"
        >
          {pending ? 'Iniciando sesión…' : (<>Entrar <Icon name="arrow-right" size={18} color="#fff"/></>)}
        </button>

        <div className="mt-1 text-center">
          <Link
            href="/login/recuperar"
            className="text-[12px] text-dark-muted underline underline-offset-4 hover:text-bg transition"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
      </form>
    </div>
  );
}

function MagicForm({
  pending, msg, onSubmit, onClearMsg, next
}: {
  pending: boolean;
  msg: Notice | null;
  onSubmit: (fd: FormData) => void;
  onClearMsg: () => void;
  next: string;
}) {
  return (
    <div className="mt-4">
      <form className="flex flex-col gap-3" action={onSubmit}>
        {next && <input type="hidden" name="next" value={next} />}
        <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line block focus-within:border-accent transition">
          <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">Nombre</span>
          <input
            name="name"
            required
            minLength={2}
            autoComplete="name"
            enterKeyHint="next"
            placeholder="Tu nombre"
            className="bg-transparent text-bg text-[16px] w-full outline-none placeholder:text-dark-muted/60"
          />
        </label>
        <label className="bg-dark-card rounded-xl px-4 py-3 border border-dark-line flex items-center gap-2.5 focus-within:border-accent transition">
          <div className="flex-1">
            <span className="block text-[10px] text-dark-muted uppercase tracking-[1.5px] mb-1">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="send"
              placeholder="vos@email.com"
              className="bg-transparent text-bg text-[16px] w-full outline-none font-mono placeholder:text-dark-muted/60"
            />
          </div>
          <Icon name="mail" size={18} color="#8C8A83"/>
        </label>

        {msg && (
          <Toast
            dark
            tone={msg.tone}
            message={msg.text}
            onClose={onClearMsg}
            autoDismissMs={5000}
          />
        )}

        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white border-0 px-4 py-3.5 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 tracking-wide disabled:opacity-60 active:scale-[0.98] transition"
        >
          {pending ? 'Enviando link…' : (<>Mandame el link <Icon name="arrow-right" size={18} color="#fff"/></>)}
        </button>
      </form>
    </div>
  );
}

function MagicLinkSentScreen({
  email, onResend, onUseOtherEmail, resending
}: {
  email: string;
  onResend: () => Promise<{ error?: string }>;
  onUseOtherEmail: () => void;
  resending: boolean;
}) {
  const [cooldown, setCooldown] = useState(30);
  const [resendMsg, setResendMsg] = useState<{ ok?: boolean; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const canResend = cooldown === 0 && !resending;

  const handleResend = async () => {
    if (!canResend) return;
    setResendMsg(null);
    const res = await onResend();
    if (res?.error) {
      setResendMsg({ text: res.error });
    } else {
      setResendMsg({ ok: true, text: 'Link reenviado. Revisá tu bandeja (y spam).' });
      setCooldown(30);
    }
  };

  return (
    <main className="min-h-screen bg-ink text-bg relative overflow-hidden flex flex-col">
      <div className="absolute -top-[120px] -right-[80px] w-[360px] h-[360px] rounded-full border border-dark-line" aria-hidden="true" />
      <div className="absolute -top-[60px] -right-[20px] w-[240px] h-[240px] rounded-full border border-dark-line" aria-hidden="true" />

      <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="w-[96px] h-[96px] rounded-full bg-accent/15 border border-accent/40 grid place-items-center">
          <Icon name="mail" size={44} color="#B6754C" />
        </div>
        <h1 className="font-display text-[40px] leading-[1.02] -tracking-[0.5px] mt-6">
          Revisá tu <span className="italic text-accent">email</span>
        </h1>
        <p className="mt-4 text-[14px] text-dark-muted max-w-[320px] leading-relaxed">
          Te mandamos un link a <span className="font-mono text-bg break-all">{email}</span>. Abrilo desde este dispositivo.
        </p>

        <div className="mt-8 w-full max-w-[320px] flex flex-col gap-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={!canResend}
            className="bg-accent text-white px-4 py-3.5 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition"
          >
            {resending
              ? 'Reenviando…'
              : cooldown > 0
                ? `Reenviar link (${cooldown}s)`
                : 'Reenviar link'}
          </button>
          <button
            type="button"
            onClick={onUseOtherEmail}
            className="text-[13px] text-dark-muted underline underline-offset-4 hover:text-bg transition"
          >
            Usar otro email
          </button>
        </div>

        {resendMsg && (
          <div className="mt-5 w-full max-w-[320px] text-left">
            <Toast
              dark
              tone={resendMsg.ok ? 'success' : 'error'}
              message={resendMsg.text}
              onClose={() => setResendMsg(null)}
              autoDismissMs={5000}
            />
          </div>
        )}

        <p className="mt-8 text-[11px] text-dark-muted max-w-[280px]">
          ¿No te llegó? Revisá spam o promociones. El link vence en 1 hora.
        </p>
      </div>
    </main>
  );
}
