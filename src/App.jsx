import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from './lib/AuthContext.jsx';
import { ChromeProvider } from './lib/ChromeContext.jsx';
import NavBar from './components/NavBar.jsx';
import Footer from './components/Footer.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Profile from './pages/Profile.jsx';
import PublicProfile from './pages/PublicProfile.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import About from './pages/About.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import Updates from './pages/Updates.jsx';

function AppRoutes() {
  const location = useLocation();

  // React Router doesn't reset scroll position on navigation the way a
  // traditional multi-page site does — without this, clicking a nav link
  // while scrolled down on the previous page lands you at that same scroll
  // depth on the new page instead of its top. Skipped when arriving via a
  // badge-toast click (see Home.jsx's BadgeToastCard) — that navigation
  // wants a specific "land at top instantly, then glide down to the
  // badges" sequence handled entirely by Profile.jsx, and this generic
  // smooth-scroll-to-top would fight it for control of the scroll position.
  useEffect(() => {
    if (location.state?.scrollToBadges) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);

  // Keying on the path forces a fresh mount per route, which replays the
  // page-transition CSS animation on every navigation.
  return (
    <div className="page-transition" key={location.pathname}>
      <Routes location={location}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/player/:userId" element={<PublicProfile />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/about" element={<About />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/updates" element={<Updates />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ChromeProvider>
        <BrowserRouter>
          <div className="app-shell">
            <NavBar />
            <AppRoutes />
            <Footer />
          </div>
          <Analytics />
        </BrowserRouter>
      </ChromeProvider>
    </AuthProvider>
  );
}
