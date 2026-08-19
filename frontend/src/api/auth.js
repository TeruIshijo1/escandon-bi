import { getToken } from './client';

export const getAuthToken = () => getToken();

export const authHeaders = (extraHeaders = {}) => {
  const token = getAuthToken();
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders };
};
