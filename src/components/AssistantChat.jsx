import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/lib/toast';
import { WHATSAPP_ENABLED } from '@/lib/config';

const AGENT_NAME = 'itrack_assistant';
const WHATSAPP_ICON = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.58 15.13L2 22l4.97-1.38A10 10 0 1 0 12 2Zm5.13 14.16c-.22.62-1.27 1.18-1.78 1.23-.46.04-1.03.06-1.66-.1-.38-.1-.87-.25-1.5-.5-2.65-1.06-4.38-3.7-4.51-3.87-.13-.18-1.08-1.44-1.08-2.75 0-1.3.68-1.94.92-2.2.24-.27.53-.34.7-.34h.5c.16 0 .38-.06.6.45.22.53.75 1.83.82 1.96.06.13.1.29.02.47-.08.18-.13.29-.25.45-.13.15-.27.34-.38.45-.13.13-.26.27-.11.53.15.26.66 1.09 1.42 1.77.98.87 1.8 1.14 2.06 1.27.25.13.4.11.55-.06.15-.18.64-.75.81-1 .17-.26.34-.21.57-.13.24.09 1.5.71 1.76.84.26.13.43.19.49.3.06.1.06.62-.15 1.23Z" />
  </svg>
);

// The agent answers in light markdown: **bold** labels and "- " bullets. Those
// two are the only markers it actually emits, and unrendered they show up as
// literal asterisks in the bubble, so they are handled inline rather than by
// pulling in a markdown dependency. The bubble keeps whitespace-pre-line, so
// line breaks still take care of themselves.
function renderMarkdownish(text) {
  const withBullets = text.replace(/^[ \t]*-[ \t]+/gm, '• ');
  const parts = [];
  let last = 0;
  for (const match of withBullets.matchAll(/\*\*(.+?)\*\*/g)) {
    if (match.index > last) parts.push(withBullets.slice(last, match.index));
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < withBullets.length) parts.push(withBullets.slice(last));
  return parts;
}

// Floating assistant chat (PRD F7): in-app conversation with itrack_assistant
// plus the WhatsApp connect link.
export default function AssistantChat() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);
  const unsubRef = useRef(null);

  const visibleMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim());

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleMessages.length, thinking, open]);

  useEffect(() => () => unsubRef.current?.(), []);

  const ensureConversation = useCallback(async () => {
    if (conversation) return conversation;
    const conv = await base44.agents.createConversation({ agent_name: AGENT_NAME });
    setConversation(conv);
    setMessages(conv.messages ?? []);
    unsubRef.current = base44.agents.subscribeToConversation(conv.id, (updated) => {
      setMessages(updated.messages ?? []);
      const last = updated.messages?.[updated.messages.length - 1];
      if (last?.role === 'assistant' && last.content?.trim()) setThinking(false);
    });
    return conv;
  }, [conversation]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setThinking(true);
    setMessages((m) => [...m, { role: 'user', content: text, id: `local-${Date.now()}` }]);
    try {
      const conv = await ensureConversation();
      await base44.agents.addMessage(conv, { role: 'user', content: text });
    } catch (err) {
      console.error(err);
      setThinking(false);
      toast.error('Assistant unavailable', 'Try again in a moment.');
    }
  };

  // getWhatsAppConnectURL builds the URL synchronously and never throws, even
  // when the agent has no WhatsApp channel, so the flag is the only thing that
  // can tell us whether the link goes anywhere.
  const whatsappUrl = WHATSAPP_ENABLED ? base44.agents.getWhatsAppConnectURL(AGENT_NAME) : null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 end-5 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground grid place-items-center card-shadow-hover hover:scale-105 transition-transform"
          aria-label="Open iTrack assistant"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 end-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm bg-card rounded-2xl border card-shadow-hover flex flex-col overflow-hidden" style={{ height: 'min(560px, calc(100dvh - 6rem))' }} role="dialog" aria-label="iTrack assistant chat">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
            <div>
              <p className="font-bold text-sm">iTrack assistant</p>
              <p className="text-xs opacity-80">Ask about any of your packages</p>
            </div>
            <div className="flex items-center gap-1">
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg hover:bg-white/15 transition-colors"
                  title="Chat on WhatsApp"
                >
                  {WHATSAPP_ICON}
                </a>
              )}
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-white/15 transition-colors" aria-label="Close chat">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {visibleMessages.length === 0 && !thinking && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-3">Try one of these:</p>
                <div className="space-y-2">
                  {["Where's my latest order?", 'What arrives this week?', 'Do I have refunds to claim?'].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="block w-full text-sm bg-muted hover:bg-secondary rounded-xl px-3 py-2 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {visibleMessages.map((m, i) => (
              <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line break-words ${
                    m.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted rounded-bl-md'
                  }`}
                >
                  {m.role === 'assistant' ? renderMarkdownish(m.content) : m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          <form onSubmit={send} className="p-3 border-t flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Where's my dog food?"
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Message the assistant"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              className="w-9 h-9 rounded-xl bg-primary text-primary-foreground grid place-items-center disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
