import { Redirect } from 'expo-router';

/** Legacy route: sign-in now starts from the user-type selection screen. */
export default function Login() {
  return <Redirect href="/auth" />;
}
