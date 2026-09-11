import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="empty">
      <p style={{ margin: 0 }}>There is nothing at this address.</p>
      <p style={{ marginTop: 12 }}>
        <Link to="/">Create a paste</Link>
      </p>
    </div>
  );
}
