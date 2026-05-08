import axios from 'axios';

import { getBeHost, getBePort } from '../socket';

const getBeUrl = () => `http://${getBeHost()}:${getBePort()}`;

const apiClient = axios.create({
  baseURL: getBeUrl(),
});

export const updateApiClientBaseUrl = () => {
  apiClient.defaults.baseURL = getBeUrl();
};


// Interceptor to add Authorization header
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor to handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('[API_CLIENT] Unauthorized access, redirecting to login...');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      if (window.location.hash !== '#/login') {
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
