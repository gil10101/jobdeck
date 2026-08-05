// Vite serves imported SVGs as URLs; typecheck needs the module shape declared.
declare module '*.svg' {
  const url: string
  export default url
}
