import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <SignIn />
    </main>
  );
}
