import { apiClient } from './client';

/** Reject delayed mutations after changing servers or management credentials. */
export const guardConfigConnection = () => {
  const revision = apiClient.getConnectionRevision();
  return () => {
    if (apiClient.getConnectionRevision() !== revision) {
      throw new Error('Management connection changed');
    }
  };
};
