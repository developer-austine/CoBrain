"use client";

import { ThemeProvider } from "next-themes";

export function AppProviders({children}:{children:React.ReactNode}){

return (
        <ThemeProvider
          // Both attributes on purpose: Tailwind's dark variant keys off the
          // `.dark` class, while the Forecasts token system is written against
          // `data-theme`. Setting only one would break the other half of the UI.
          attribute={["class", "data-theme"]}
          defaultTheme="system"
          enableSystem
          storageKey="cb-theme"
          disableTransitionOnChange
        >
             {children}
        </ThemeProvider>
)
}