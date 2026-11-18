import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import Sheet from './Sheet';
import { supabase } from '../supabase';

interface TokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

const GUIDE_URL = 'https://github.com/asyraffff/saves/blob/main/SHORTCUT.md';

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'svs_' + b64;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt('Copy this:', text);
        }
      }}
    >
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

export default function Settings({ session, onClose }: { session: Session; onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from('api_tokens')
      .select('id, label, created_at, last_used_at')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setTokens(data as TokenRow[]);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    const token = makeToken();
    const { error } = await supabase
      .from('api_tokens')
      .insert({ user_id: session.user.id, token_hash: await sha256Hex(token), label: 'iPhone Shortcut' });
    if (error) return setError(error.message);
    setFresh(token);
    void load();
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this token? Any Shortcut using it will stop working.')) return;
    await supabase.from('api_tokens').delete().eq('id', id);
    void load();
  }

  const origin = window.location.origin;

  return (
    <Sheet title="Settings" onClose={onClose}>
      <section className="stack">
        <h3>iPhone share sheet</h3>
        <p className="muted small">
          The “Save to Saves” Shortcut puts this app in the Threads and TikTok share sheet. It needs your app address and a
          personal token. <a href={GUIDE_URL} target="_blank" rel="noreferrer">Setup guide ↗</a>
        </p>
        <div className="kv">
          <span className="muted small">App address</span>
          <code className="mono">{origin}</code>
          <Copy text={origin} />
        </div>
        {fresh ? (
          <div className="token-box">
            <p className="small">
              <strong>Your new token.</strong> Copy it into the Shortcut now; it won't be shown again.
            </p>
            <code className="mono break">{fresh}</code>
            <Copy text={fresh} />
          </div>
        ) : (
          <button className="btn primary" onClick={create}>
            Create Shortcut token
          </button>
        )}
        {error && <p className="error">{error}</p>}
        {tokens.length > 0 && (
          <ul className="token-list">
            {tokens.map((t) => (
              <li key={t.id}>
                <div>
                  <div>{t.label}</div>
                  <div className="muted small">
                    Created {new Date(t.created_at).toLocaleDateString()} ·{' '}
                    {t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleString()}` : 'never used'}
                  </div>
                </div>
                <button className="btn small danger" onClick={() => revoke(t.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="stack">
        <h3>Account</h3>
        <p className="muted small">Signed in as {session.user.email}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>
    </Sheet>
  );
}
