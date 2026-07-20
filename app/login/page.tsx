import { signIn, signUp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>CopyCreator</CardTitle>
          <CardDescription>Sign in to manage your Threads creator tracker.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
              />
            </div>

            {searchParams?.error && (
              <p className="text-sm text-red-600">{searchParams.error}</p>
            )}
            {searchParams?.message && (
              <p className="text-sm text-green-600">{searchParams.message}</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button formAction={signIn} className="flex-1">
                Sign in
              </Button>
              <Button formAction={signUp} variant="outline" className="flex-1">
                Sign up
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
