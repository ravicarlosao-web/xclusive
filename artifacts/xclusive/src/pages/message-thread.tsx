import { useState, useRef, useEffect } from 'react';
import { useRoute, Link } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Phone, Video, Info, Image as ImageIcon, Heart, Smile, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// Mock messages
const MOCK_MESSAGES = [
  { id: 1, sender: 'them', text: 'Olá! Viste o meu último post?', time: '10:00' },
  { id: 2, sender: 'me', text: 'Sim, está brutal! Adorei a edição 🔥', time: '10:05' },
  { id: 3, sender: 'them', text: 'Obrigada! Demorou imenso a fazer.', time: '10:06' },
  { id: 4, sender: 'me', text: 'Nota-se o esforço. Continua o bom trabalho!', time: '10:10' },
];

export default function MessageThread() {
  const [, params] = useRoute('/mensagens/:id');
  const { user } = useAuth();
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [inputText, setInputText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mock user data for header
  const partnerUser = { username: 'sofiacosta', avatar: 'https://i.pravatar.cc/150?u=1', name: 'Sofia Costa' };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    const newMsg = {
      id: Date.now(),
      sender: 'me',
      text: inputText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages([...messages, newMsg]);
    setInputText('');
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-background relative z-50 md:z-auto">
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Link href="/mensagens" className="md:hidden">
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <Link href={`/perfil/${partnerUser.username}`} className="flex items-center gap-3">
            <Avatar className="w-10 h-10 border border-border">
              <AvatarImage src={partnerUser.avatar} />
              <AvatarFallback>{partnerUser.name[0]}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-bold text-sm leading-tight">{partnerUser.name}</span>
              <span className="text-xs text-muted-foreground">Ativo(a) há 2m</span>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-4 text-foreground">
          <button className="hover:text-primary transition-colors"><Phone className="w-6 h-6" /></button>
          <button className="hover:text-primary transition-colors"><Video className="w-6 h-6" /></button>
          <button className="hover:text-primary transition-colors"><Info className="w-6 h-6" /></button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col">
        <div className="flex flex-col items-center justify-center py-10">
          <Avatar className="w-24 h-24 mb-4">
            <AvatarImage src={partnerUser.avatar} />
            <AvatarFallback>{partnerUser.name[0]}</AvatarFallback>
          </Avatar>
          <h2 className="text-xl font-bold">{partnerUser.name}</h2>
          <span className="text-muted-foreground text-sm">Xclusive</span>
          <button className="mt-4 px-4 py-1.5 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-semibold transition-colors">
            Ver Perfil
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => {
            const isMe = msg.sender === 'me';
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <Avatar className="w-8 h-8 mr-2 self-end mb-1">
                    <AvatarImage src={partnerUser.avatar} />
                  </Avatar>
                )}
                <div className={`group relative flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-[15px] ${
                    isMe 
                      ? 'bg-primary text-white rounded-br-sm shadow-[0_4px_10px_rgba(255,62,114,0.15)]' 
                      : 'bg-secondary text-foreground rounded-bl-sm border border-border'
                  }`}>
                    {msg.text}
                  </div>
                  <span className={`text-[10px] text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity absolute ${isMe ? 'right-0 -bottom-4' : 'left-0 -bottom-4'}`}>
                    {msg.time}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-card">
        <div className="flex items-center gap-2 bg-secondary rounded-full px-4 py-2 border border-transparent focus-within:border-border">
          <button className="text-muted-foreground hover:text-primary transition-colors bg-primary/10 p-1.5 rounded-full">
            <ImageIcon className="w-5 h-5 text-primary" />
          </button>
          <Input 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Mensagem..." 
            className="flex-1 bg-transparent border-none focus-visible:ring-0 shadow-none h-10"
          />
          {inputText.trim() ? (
            <button onClick={handleSend} className="text-primary hover:text-primary/80 font-bold px-2">
              Enviar
            </button>
          ) : (
            <>
              <button className="text-muted-foreground hover:text-foreground transition-colors"><Heart className="w-6 h-6" /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}