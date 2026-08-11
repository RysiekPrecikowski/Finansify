import { SignIn } from '@clerk/nextjs';

// One of the two routes ADR 0009 (rule 4) names as the exception where Clerk's
// own components appear directly, rather than going through src/lib/auth/.
export default function SignInPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-4">
      <SignIn />
    </div>
  );
}
