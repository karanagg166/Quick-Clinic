

export default function UnauthorizedPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center' }}>
      <h1>Error 403: Unauthorized Access</h1>
      <p>You do not have permission to view this page.</p>
    </div>
  );
}