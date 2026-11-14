import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import './clinic.css'
import { fmtWeekday, isMock } from './data'
import Live from './Live'
import Patient from './Patient'
import Today, { href } from './Today'
import Hall from './Hall'

// Clinician side of Vire. Mounted at /#/clinic/*.
//   /clinic            who needs a call today
//   /clinic/p/:id      one person
//   /clinic/live       big-screen mirror: opens the newest room
//   /clinic/live/:code mirror of one room (`*` = any)
export default function Clinic() {
  return (
    <Routes>
      <Route path="live" element={<Live />} />
      <Route path="live/:code" element={<Live />} />
      <Route element={<Shell />}>
        <Route index element={<Today />} />
        <Route path="hall" element={<Hall />} />
        <Route path="p/:id" element={<Patient />} />
        <Route path="*" element={<Today />} />
      </Route>
    </Routes>
  )
}

function Shell() {
  // the hall page shows the real people who tried it at Junction; every other clinic screen holds simulated patients
  const hall = useLocation().pathname.includes('/hall')
  return (
    <div className="cl">
      <nav className="cl-bar" aria-label="Clinic">
        <NavLink to={href('/clinic')} end className="cl-brand">
          Vire <span>clinic</span>
        </NavLink>
        <div className="cl-nav">
          <NavLink to={href('/clinic')} end>
            Today
          </NavLink>
          <NavLink to={href('/clinic/live')}>Live mirror</NavLink>
          <NavLink to={href('/clinic/hall')}>Hall today</NavLink>
        </div>
        <div className="cl-bar-right">
          {!hall && <span className="cl-simflag">Simulated patients</span>}
          {isMock() && <span className="cl-mockflag">Mock data</span>}
          <time>{fmtWeekday(Date.now())}</time>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}
