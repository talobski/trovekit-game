import { Home } from "./screens/home"
import { RoomScreen } from "./screens/room"
import { usePath, ROOM_CODE } from "./router"

export function App() {
  const path = usePath()
  const m = path.match(/^\/r\/([A-Za-z0-9]+)\/?$/)
  if (m) {
    const code = m[1].toUpperCase()
    if (ROOM_CODE.test(code)) return <RoomScreen key={code} code={code} />
  }
  return <Home />
}
