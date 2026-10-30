import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/lib/theme"
import "@/styles/index.css"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {/* Toasts sit inside the provider: their resource chips use tooltips. */}
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="top-center" visibleToasts={3} duration={3500} />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
