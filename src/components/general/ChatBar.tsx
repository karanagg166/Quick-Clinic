'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader, AlertCircle } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollHeight, 120) + 'px';
    }
  }, [inputValue]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // create a fake form event to reuse send handler
      handleSendMessage({ preventDefault: () => {} } as unknown as React.FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-10 bg-background">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Chat</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Secure conversation with your provider</p>
          </div>
          <Badge variant={isConnected ? "default" : "destructive"} className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {isConnected ? 'Connected' : 'Connecting'}
          </Badge>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scroll-smooth">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
              <p className="text-gray-600 font-medium text-lg">Loading messages...</p>
              <p className="text-xs text-gray-400 mt-2">Make sure Socket.IO server is running</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">💬</span>
              </div>
              <p className="text-gray-700 font-semibold text-lg">No messages yet</p>
              <p className="text-sm text-gray-500 mt-2">Start the conversation by sending a message</p>
            </div>
          </div>
        ) : (
          messages.map((message, idx) => (
            <div
              key={message.id}
              className={`flex ${message.senderId === userId ? 'justify-end' : 'justify-start'} animate-fadeIn`}
            >
              <div
                className={`max-w-[72%] px-4 py-2.5 rounded-2xl shadow-sm ${
                  message.senderId === userId
                    ? 'bg-blue-500 text-white rounded-br-none'
                    : 'bg-gray-200 text-gray-800 rounded-bl-none'
                }`}
              >
                <p className={`text-[11px] font-semibold mb-1 ${
                  message.senderId === userId ? 'text-blue-100' : 'text-gray-600'
                }`}>
                  {message.senderName}
                </p>
                <p className="text-[13px] wrap-break-word leading-relaxed">{message.text}</p>
                <p className={`text-[11px] mt-1.5 ${
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
            <div className="bg-gray-200 text-gray-800 px-5 py-3 rounded-2xl rounded-bl-none shadow-sm">
              <p className="text-xs font-semibold mb-2 text-gray-600">{typingUser}</p>
              <div className="flex gap-1">
                <div className="w-2.5 h-2.5 bg-gray-500 rounded-full animate-bounce" />
                <div className="w-2.5 h-2.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2.5 h-2.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-6 py-3 bg-destructive/10 border-b border-destructive/20 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t px-6 py-3 sticky bottom-0 bg-background">
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message (Shift+Enter for newline)"
            disabled={sending || !isConnected}
            rows={1}
            className="flex-1 resize-none rounded-2xl"
          />
          <Button
            type="submit"
            disabled={sending || !inputValue.trim() || !isConnected}
            size="icon"
            className="rounded-xl"
          >
            {sending ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

