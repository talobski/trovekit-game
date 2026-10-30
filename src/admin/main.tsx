import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/lib/theme"
import "@/styles/index.css"
import { AdminApp } from "./AdminApp"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminApp />
      <Toaster position="bottom-right" />
    </ThemeProvider>
  </StrictMode>
)
