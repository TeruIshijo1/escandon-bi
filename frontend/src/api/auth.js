export const getAuthToken = () => (
  sessionStorage.getItem('escandon_token') ||
  localStorage.getItem('token') ||
  ''
);

export const authHeaders = (extraHeaders = {}) => {
  const token = getAuthToken();
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders };
};
