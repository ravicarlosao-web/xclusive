import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Desktop Sidebar */}
      <div className={`hidden md:block transition-all duration-300 border-r border-border bg-[hsl(var(--sidebar))] z-10 ${sidebarOpen ? 'w-64' : 'w-20'}`}>
        <Sidebar collapsed={!sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar>
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="mr-2">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64 bg-[hsl(var(--sidebar))] border-r-border">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Sidebar collapsed={false} isMobile onToggle={() => {}} />
              </SheetContent>
            </Sheet>
          </div>
        </Topbar>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-background">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
