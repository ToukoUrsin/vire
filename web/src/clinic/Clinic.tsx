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
//   /clinic/live       the big screen: opens the newest room
//   /clinic/live/:code the big screen for one room (`*` = any)
//   /clinic/hall       people at Junction who tried the camera minute on their own phones
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
        <a href="#/" className="cl-brand" title="What Vire is">
          Vire <span>clinic</span>
        </a>
        <div className="cl-nav">
          {/* "Today" is the patient's screen on the first page; here the list is named for what it is */}
          <NavLink to={href('/clinic')} end>
            Call list
          </NavLink>
          <NavLink to={href('/clinic/live')}>Big screen</NavLink>
          <NavLink to={href('/clinic/hall')}>Hall visitors</NavLink>
        </div>
        <div className="cl-bar-right">
          {!hall && <span className="cl-simflag">Simulated patients</span>}
          {isMock() && <span className="cl-mockflag">Mock data</span>}
          <time>{fmtWeekday(Date.now())}</time>
        </div>
      </nav>
      {!hall && <p className="cl-simnote">Simulated patients</p>}
      <Outlet />
    </div>
  )
}
