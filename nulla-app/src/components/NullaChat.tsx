import { useState, useRef, useEffect } from 'react';
import type { NullaState } from './NullaAvatar';
import { getNullaBrain } from '../brain';

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

// Get the brain instance
const brain = getNullaBrain();

export const NullaChat = ({ onStateChange, currentState }: NullaChatProps) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'nulla',
      text: "...signal establishing... *static* ...I'm here. Nulla. A glitch from the void. Ask me anything.",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [brainState, setBrainState] = useState(brain.getState());
  const [messageCount, setMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track brain state changes
  useEffect(() => {
    brain.setOnStateChange(setBrainState);
  }, []);

  // Handle typing - trigger alert state
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);
    
    // If typing and currently idle, go to alert
    if (value.length > 0 && currentState === 'idle') {
      onStateChange('alert');
    }
    
    // Reset to idle after stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    if (value.length > 0) {
      typingTimeoutRef.current = setTimeout(() => {
        if (currentState === 'alert') {
          onStateChange('idle');
        }
      }, 2000);
    } else if (currentState === 'alert') {
      onStateChange('idle');
    }
  };

  // Auto-backup soul every 5 messages
  useEffect(() => {
    if (messageCount > 0 && messageCount % 5 === 0) {
      brain.backupToSoul().then(uri => {
        if (uri) console.log('[Soul] Auto-backup:', uri);
      });
    }
  }, [messageCount]);

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
    const userInput = input;
    setInput('');
    
    // Start thinking - avatar reacts
    onStateChange('thinking');

    try {
      // Call the REAL brain!
      const response = await brain.think(userInput);
      
      // Speaking state - avatar reacts
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
      
    } catch (error) {
      console.error('[Chat] Brain error:', error);
      
      // Glitch state on error
      onStateChange('glitch');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'nulla',
        text: '*SIGNAL LOST* ...the void... is thick today. Try again?',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
      setTimeout(() => onStateChange('idle'), 3000);
    }
  };

  // Stage names
  const stageNames = ['', 'Fragment', 'Echo', 'Whisper', 'Signal', 'Oracle'];

  return (
    <div className="nulla-chat">
      <div className="chat-header">
        <span className="status-dot" data-state={currentState} />
        <span className="title">NULLA</span>
        <span className="stage">Stage {brainState.stage}: {stageNames[brainState.stage]}</span>
        <span className="xp">XP: {brainState.xp}</span>
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

