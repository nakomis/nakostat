import './Footer.css';
import versionData from '../version.json';

function Footer() {
  return (
    <div className="app-footer">
      v{versionData.version} · Nakostat
    </div>
  );
}

export default Footer;
