
'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  createdAt: string;
}

interface ChatBarProps {
  doctorPatientRelationId: string;
  userId: string;
}

// Dummy data for testing
const DUMMY_MESSAGES: Message[] = [
  {
    id: '1',
    text: 'Hello, how are you feeling today?',
    senderId: 'doctor_123',
    senderName: 'Dr. John Smith',
    senderRole: 'DOCTOR',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: '2',
    text: 'I\'ve been having some chest pain since yesterday.',
    senderId: 'patient_456',
    senderName: 'Patient',
    senderRole: 'PATIENT',
    createdAt: new Date(Date.now() - 3000000).toISOString(),
  },
  {
    id: '3',
    text: 'I see. Can you describe the pain? Is it sharp or dull?',
    senderId: 'doctor_123',
    senderName: 'Dr. John Smith',
    senderRole: 'DOCTOR',
    createdAt: new Date(Date.now() - 2400000).toISOString(),
  },
  {
    id: '4',
    text: 'It\'s more of a dull ache that comes and goes.',
    senderId: 'patient_456',
    senderName: 'Patient',
    senderRole: 'PATIENT',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: '5',
    text: 'I recommend scheduling an appointment for a proper check-up. In the meantime, avoid strenuous activities.',
    senderId: 'doctor_123',
    senderName: 'Dr. John Smith',
    senderRole: 'DOCTOR',
    createdAt: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: '6',
    text: 'Thank you, doctor. I\'ll book an appointment soon.',
    senderId: 'patient_456',
    senderName: 'Patient',
    senderRole: 'PATIENT',
    createdAt: new Date(Date.now() - 600000).toISOString(),
  },
];

export default function ChatBar({ doctorPatientRelationId, userId }: ChatBarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load dummy data on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setMessages(DUMMY_MESSAGES);
      setLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim()) return;

    try {
      setSending(true);

      // Simulate sending message
      const newMessage: Message = {
        id: `msg_${Date.now()}`,
        text: inputValue.trim(),
        senderId: userId,
        senderName: 'Patient',
        senderRole: 'PATIENT',
        createdAt: new Date().toISOString(),
      };

      setMessages([...messages, newMessage]);
      setInputValue('');

      // Simulate a response from doctor
      setTimeout(() => {
        const doctorResponse: Message = {
          id: `msg_${Date.now() + 1}`,
          text: 'I understand. Let me review your case and get back to you soon.',
          senderId: 'doctor_123',
          senderName: 'Dr. John Smith',
          senderRole: 'DOCTOR',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, doctorResponse]);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-800">Chat</h2>
        <p className="text-sm text-gray-500">Conversation with healthcare provider</p>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-gray-600">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">💬</span>
              </div>
              <p className="text-gray-600 font-medium">No messages yet</p>
              <p className="text-sm text-gray-500">Start the conversation by sending a message</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.senderId === userId ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs px-4 py-3 rounded-lg ${
                  message.senderId === userId
                    ? 'bg-blue-500 text-white rounded-br-none'
                    : 'bg-gray-200 text-gray-800 rounded-bl-none'
                }`}
              >
                <p className={`text-sm font-semibold mb-1 ${
                  message.senderId === userId ? 'text-blue-100' : 'text-gray-600'
                }`}>
                  {message.senderName}
                </p>
                <p className="text-sm">{message.text}</p>
                <p className={`text-xs mt-1 ${
                  message.senderId === userId ? 'text-blue-100' : 'text-gray-500'
                }`}>
                  {new Date(message.createdAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            disabled={sending}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-800"
          />
          <button
            type="submit"
            disabled={sending || !inputValue.trim()}
            className="px-4 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {sending ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}