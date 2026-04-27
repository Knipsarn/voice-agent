/**
 * lib/auth-config.js
 *
 * NextAuth configuration. Google OAuth provider (sign-in with Google).
 * Sessions are JWT-based (no DB needed). Email is added to the session
 * so server components and API routes can authorize via tenant-map.
 */

import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (profile?.email) token.email = profile.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = token.email;
      return session;
    },
  },
  pages: { signIn: "/login" },
};
