import { Link } from 'react-router-dom';
import { useChrome } from '../lib/ChromeContext.jsx';
import { playNav } from '../lib/sound.js';

export default function Footer() {
  const { collapsed } = useChrome();

  return (
    <footer className={'site-footer' + (collapsed ? ' site-footer--collapsed' : '')}>
      <div className="site-footer-links">
        <Link to="/about" onClick={playNav} className="footer-link">About</Link>
        <a href="https://discord.gg/6mXxFXM42" target="_blank" rel="noopener noreferrer" className="footer-link">Discord</a>
        <Link to="/privacy" onClick={playNav} className="footer-link">Privacy Policy</Link>
        <Link to="/terms" onClick={playNav} className="footer-link">Terms of Service</Link>
        <a href="mailto:support@pushdle.com" className="footer-link">Contact</a>
        <Link to="/updates" onClick={playNav} className="footer-link">Updates</Link>
      </div>
      <div className="mono site-footer-copy">© {new Date().getFullYear()} Pushdle. For entertainment purposes only.</div>
    </footer>
  );
}
