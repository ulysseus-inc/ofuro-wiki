export const Logo = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <img
        src="/favicon-96.png"
        alt="ofuro-wiki"
        width={40}
        height={40}
        style={{ borderRadius: '8px' }}
      />
      <span
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: '#3C2415',
          letterSpacing: '-0.5px',
        }}
      >
        ofuro-wiki
      </span>
    </div>
  );
};
