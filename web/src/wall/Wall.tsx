// The hall wall (owned by WALL, round 2).
//   #/wall            the big screen at the table (1920x1080), or the same stacked on a phone
//   #/wall?u=<id>     one visitor's own dot, on their phone
//   #/wall/poster     the printable A4 poster
//   ?demo=<n>&h=<hour> asks the server for simulated data; it comes back flagged and the wall says so
import { Route, Routes, useLocation } from 'react-router-dom'
import { Big } from './Big'
import { Me } from './Me'
import { Poster } from './Poster'
import { useWall } from './lib'
import './wall.css'

export default function Wall() {
  return (
    <Routes>
      <Route path="poster" element={<Poster />} />
      <Route path="*" element={<Live />} />
    </Routes>
  )
}

function Live() {
  const loc = useLocation()
  const u = new URLSearchParams(loc.search).get('u') ?? new URLSearchParams(window.location.search).get('u')
  const feed = useWall(u, u ? 8000 : 5000)
  return u ? <Me feed={feed} /> : <Big feed={feed} />
}
