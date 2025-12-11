'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader, AlertCircle } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

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

export default function ChatBar({ doctorPatientRelationId, userId }: ChatBarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize Socket.io connection
  useEffect(() => {
    const connectSocket = () => {
      try {
        // Connect to separate Socket.io server
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
        
        console.log('Connecting to Socket.IO server:', socketUrl);
        
        const socket = io(socketUrl, {
          auth: {
            relationId: doctorPatientRelationId,
            userId,
          },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
          console.log('Socket connected successfully');
          setIsConnected(true);
          setError(null);

          // Request initial messages
          socket.emit('get_initial_messages', { page: 1, limit: 50 });
        });

        socket.on('connected', (data: any) => {
          console.log('Connection confirmed:', data);
        });

        socket.on('initial_messages', (data: any) => {
          console.log('Received initial messages:', data);
          setMessages(data.messages || []);
          setLoading(false);
        });

        socket.on('new_message', (data: any) => {
          console.log('Received new message:', data);
          setMessages((prev) => {
            const isDuplicate = prev.some((msg) => msg.id === data.message.id);
            return isDuplicate ? prev : [...prev, data.message];
          });
        });

        socket.on('user_typing', (data: any) => {
          if (data.userId !== userId) {
            setTypingUser(data.userName || data.userId);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
          }
        });

        socket.on('error', (data: any) => {
          console.error('Socket error:', data);
          setError(data.message || 'Socket error occurred');
          setLoading(false);
        });

        socket.on('disconnect', (reason: string) => {
          console.log('Socket disconnected:', reason);
          setIsConnected(false);
        });

        socket.on('connect_error', (error: any) => {
          console.error('Connection error:', error.message);
          setError('Cannot connect to chat server. Please ensure the Socket.IO server is running on port 4000.');
          setIsConnected(false);
          setLoading(false);
        });

        socketRef.current = socket;

        return socket;
      } catch (err) {
        console.error('Socket initialization error:', err);
        setError('Failed to initialize chat connection');
        setLoading(false);
        return null;
      }
    };

    const socket = connectSocket();

    return () => {
      if (socket) {
        console.log('Disconnecting socket');
        socket.disconnect();
      }
    };
  }, [doctorPatientRelationId, userId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleTyping = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('user_typing');
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim()) return;
    
    if (!isConnected || !socketRef.current) {
      setError('Not connected to chat server. Please refresh the page.');
      return;
    }

    try {
      setSending(true);

      if (socketRef.current.connected) {
        console.log('Sending message:', inputValue.trim());
        
        socketRef.current.emit('send_message', {
          text: inputValue.trim(),
        });

        setInputValue('');
        setError(null);
      } else {
        setError('Connection lost. Trying to reconnect...');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Chat</h2>
            <p className="text-sm text-gray-500">Conversation with healthcare provider</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium text-gray-600">
              {isConnected ? 'Connected' : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-gray-600">Loading messages...</p>
              <p className="text-xs text-gray-400 mt-2">Make sure Socket.IO server is running</p>
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
                <p className="text-sm break-words">{message.text}</p>
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

        {/* Typing Indicator */}
        {typingUser && typingUser !== userId && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-800 px-4 py-3 rounded-lg rounded-bl-none">
              <p className="text-sm font-semibold mb-1 text-gray-600">{typingUser}</p>
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-6 py-4">
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleTyping();
            }}
            placeholder="Type your message..."
            disabled={sending || !isConnected}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-800"
          />
          <button
            type="submit"
            disabled={sending || !inputValue.trim() || !isConnected}
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

