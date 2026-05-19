// Wrapper de la vista pública del cliente. Diseño mobile-first (ancho ~440px),
// pero en desktop expandimos a 720px y agregamos un fondo decorativo para que
// no parezca "una app sobrante centrada en pantalla". Las páginas internas
// pueden romper este límite explícitamente cuando necesitan ancho completo.
export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-dark md:bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] md:from-dark-card md:via-dark md:to-dark">
      <div className="mx-auto min-h-screen max-w-[440px] md:max-w-[720px] bg-bg md:shadow-2xl md:shadow-black/30 md:rounded-xl md:my-6 md:min-h-[calc(100vh-3rem)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}
