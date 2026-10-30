import { readStored, writeStored } from "@/lib/storage"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type Theme = "light" | "dark" | "system"
type Resolved = "light" | "dark"

const Ctx = createContext<{ theme: Theme; resolvedTheme: Resolved; setTheme: (t: Theme) => void }>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
})

function read(): Theme {
  try {
    const v = readStored("theme")
    if (v === "light" || v === "dark" || v === "system") return v
  } catch {
    /* storage unavailable */
  }
  return "system"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  const resolvedTheme: Resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      writeStored("theme", t)
    } catch {
      /* storage unavailable */
    }
  }

  return <Ctx.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme() {
  return useContext(Ctx)
}
