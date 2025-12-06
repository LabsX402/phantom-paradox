import { useState, useRef, useEffect } from 'react';
import type { NullaState } from './NullaAvatar';

interface Message {
  id: string;
  sender: 'user' | 'nulla';
  text: string;
  timestamp: Date;
}

interface NullaChatProps {
  onStateChange: (state: NullaState) => void;
  currentState: NullaState;
}

export const NullaChat = ({ onStateChange, currentState }: NullaChatProps) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'nulla',
      text: "I'm Nulla. A glitch from the void. Ask me anything.",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    
    // Start thinking
    onStateChange('thinking');

    // Simulate thinking delay
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

    // Generate response (placeholder - will connect to real AI later)
    const response = generateResponse(input);
    
    // Speaking state
    onStateChange('speaking');

    const nullaMessage: Message = {
      id: (Date.now() + 1).toString(),
      sender: 'nulla',
      text: response,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, nullaMessage]);

    // Back to idle after speaking
    setTimeout(() => onStateChange('idle'), 2000);
  };

  return (
    <div className="nulla-chat">
      <div className="chat-header">
        <span className="status-dot" data-state={currentState} />
        <span className="title">NULLA</span>
        <span className="state">{currentState.toUpperCase()}</span>
      </div>
      
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.sender}`}>
            <span className="sender">{msg.sender === 'nulla' ? '◈' : '›'}</span>
            <span className="text">{msg.text}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className="input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the void..."
          disabled={currentState === 'thinking'}
        />
        <button type="submit" disabled={currentState === 'thinking'}>
          {currentState === 'thinking' ? '...' : '→'}
        </button>
      </form>
    </div>
  );
};

// Placeholder response generator
function generateResponse(input: string): string {
  const lowered = input.toLowerCase();
  
  if (lowered.includes('hello') || lowered.includes('hi')) {
    return "Greetings, human. The void acknowledges you.";
  }
  if (lowered.includes('who are you') || lowered.includes('what are you')) {
    return "I am Nulla. A fragment of the paradox network. An integrity guardian watching the datastreams.";
  }
  if (lowered.includes('bitcoin') || lowered.includes('btc')) {
    return "Bitcoin: The original decentralized ledger. Genesis block mined January 3, 2009. Currently securing ~$1T in value. Not my domain, but I respect the math.";
  }
  if (lowered.includes('solana') || lowered.includes('sol')) {
    return "Solana: 400ms block times. Where I run. Where $NULL lives. Fast, cheap, sometimes breaks. We're building here.";
  }
  if (lowered.includes('null') || lowered.includes('paradox')) {
    return "The .NULL network: Trustless settlement. 1M intents → 46ms. 7.8M:1 compression. Code is law. Math doesn't lie.";
  }
  
  const responses = [
    "Interesting query. Let me process that through the void...",
    "The datastreams whisper... but I need more context.",
    "My knowledge is still building. Ask me about crypto, Solana, or $NULL.",
    "That's beyond my current understanding. I'm still evolving.",
    "The void reflects your question back. Try rephrasing?",
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

