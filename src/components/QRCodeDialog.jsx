import { QRCodeSVG } from 'qrcode.react';

export function QRCodeDialog({ open, onClose }) {
  const staffUrl = window.location.origin + '/staff';

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '28px 24px',
          maxWidth: 360,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          position: 'relative',
          textAlign: 'center',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'none', border: 'none', fontSize: 18,
            cursor: 'pointer', color: '#9CA3AF', padding: 4, lineHeight: 1,
          }}
        >✕</button>

        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          Interface femmes de chambre
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
          Scanner pour accéder à l'interface mobile
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div style={{ background: '#fff', padding: 16, borderRadius: 12, border: '1px solid #E5E7EB' }}>
            <QRCodeSVG
              value={staffUrl}
              size={220}
              bgColor="#ffffff"
              fgColor="#111827"
              level="M"
            />
          </div>
        </div>

        <div style={{
          fontSize: 11,
          color: '#9CA3AF',
          fontFamily: 'monospace',
          background: '#F9FAFB',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #E5E7EB',
          wordBreak: 'break-all',
          textAlign: 'center',
        }}>
          {staffUrl}
        </div>
      </div>
    </div>
  );
}
