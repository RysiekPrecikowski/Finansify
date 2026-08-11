import { SignUp } from '@clerk/nextjs';

// The route Clerk's invitation flow lands an invited user on to finish account
// setup. Public self-serve sign-up is switched off in the Clerk dashboard
// ("restricted" sign-up mode) — see the two-user note in docs/decisions/0009.
export default function SignUpPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-4">
      <SignUp />
    </div>
  );
}
