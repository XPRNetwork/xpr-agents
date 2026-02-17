import { useState, useRef, useEffect } from 'react';
import { chatWithAgent } from '@/lib/deploy-api';

interface Message {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

interface ChatPanelProps {
  agent: string;
  token: string;
  endpoint: string;
}

export function ChatPanel({ agent, token, endpoint }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError('');

    const userMessage: Message = { role: 'user', text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const result = await chatWithAgent(agent, text, token);
      const agentMessage: Message = {
        role: 'agent',
        text: result.response || result.message || JSON.stringify(result),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, agentMessage]);
    } catch (e: any) {
      setError(e.message || 'Failed to send message');
      const errorMessage: Message = {
        role: 'agent',
        text: `Error: ${e.message || 'Failed to get response'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-xpr-border">
        <div>
          <h3 className="font-medium">Chat with {agent}</h3>
          <p className="text-xs text-gray-500 font-mono truncate">{endpoint}</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[500px] space-y-3 mb-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Send a message to start chatting with your agent.
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-xpr-purple/30 border border-xpr-purple/50'
                  : 'bg-xpr-dark border border-xpr-border'
              }`}
            >
              <div
                className={`text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'agent' ? 'font-mono text-gray-300' : ''
                }`}
              >
                {msg.text}
              </div>
              <div className="text-[10px] text-gray-600 mt-1 text-right">
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-xpr-dark border border-xpr-border rounded-lg px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <div className="animate-spin w-3.5 h-3.5 border-2 border-xpr-purple border-t-transparent rounded-full" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {error && (
        <div className="text-xs text-red-400 mb-2">{error}</div>
      )}

      {/* Input area */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          className="input flex-1"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="btn-primary px-4"
        >
          Send
        </button>
      </div>
    </div>
  );
}
