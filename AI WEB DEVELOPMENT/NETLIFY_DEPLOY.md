# Deploy LifeLens on Netlify

1. Push these files to the folder that contains `package.json`.
2. In Netlify, choose **Add new project → Import an existing project → GitHub**.
3. Select the LifeLens repository.
4. If the app is inside a subfolder, set **Base directory** to that folder.
5. Netlify reads `netlify.toml`, so the publish directory is `public`.
6. Add the environment variable `OPENROUTER_API_KEY` under **Project configuration → Environment variables**.
7. Deploy.
8. Add the generated `*.netlify.app` domain to Firebase Authentication → Settings → Authorized domains.

The frontend can continue calling `/api/chat`; Netlify redirects it to the serverless function.
