;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory()
  else root.PasswordValidator = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // Top 260 most-breached passwords — checked locally before hitting HIBP API
  const COMMON = new Set([
    'password','123456','12345678','qwerty','abc123','monkey','master','dragon',
    '111111','baseball','iloveyou','trustno1','sunshine','princess','welcome',
    'shadow','superman','michael','jessica','password1','batman','letmein',
    'hello','charlie','donald','qwerty123','password123','iloveyou1','admin',
    '1q2w3e4r','passw0rd','123456789','1234567890','qwertyuiop','1qaz2wsx',
    'admin123','admin1234','pass1234','pass123','test123','test1234','changeme',
    'zxcvbnm','asdfgh','qazwsx','football','soccer','summer','winter','spring',
    'autumn','hunter2','696969','mustang','maverick','coffee','matrix','cheese',
    'pepper','buster','taylor','access','thomas','hunter','ranger','tigger',
    'harley','robert','killer','jordan','joshua','george','andrew','daniel',
    'jennifer','abc1234','abcdef','abcdef1','password2','pass@123','P@ssw0rd',
    'Passw0rd','Password1','Admin@123','p@ssw0rd','p@ssword','root','toor',
    'ubnt','default','raspberry','alpine','cisco','oracle','postgres','mysql',
    'mongo','redis','qwerty1','qwerty12','123qwe','123qwer','q1w2e3r4','1q2w3e',
    'abc','abcd','test','user','guest','demo','service','manage','operator',
    'support','admin!','login','pass','secure','letmein1','pass1','123abc',
    'passw','password!','testing','test1','abc12345','password12','pass12345',
    'mypassword','mypass','secret','secret1','secret123','qwerty!','qwerty1!',
    '11111111','22222222','12121212','11223344','123123','654321','666666',
    '999999','112233','121212','131313','232323','246810','147258','159753',
    'p@ss123','Pa$$w0rd','P@$$w0rd','P@$$word','Passw0rd1','admin2024','admin2025',
  ])

  async function checkPwned(password) {
    try {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
      const prefix = hex.slice(0, 5)
      const suffix = hex.slice(5)
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' }
      })
      const text = await res.text()
      for (const line of text.split('\r\n')) {
        const [s, c] = line.split(':')
        if (s && s.trim() === suffix) return parseInt(c) || 1
      }
      return 0
    } catch {
      return -1
    }
  }

  function getPercent(pw) {
    let s = 0
    if (pw.length >= 8)  s += 10
    if (pw.length >= 12) s += 15
    if (pw.length >= 16) s += 10
    if (pw.length >= 20) s += 5
    if (/[a-z]/.test(pw)) s += 5
    if (/[A-Z]/.test(pw)) s += 10
    if (/[0-9]/.test(pw)) s += 10
    if (/[^a-zA-Z0-9]/.test(pw)) s += 15
    const types = [/[a-z]/,/[A-Z]/,/[0-9]/,/[^a-zA-Z0-9]/].filter(r => r.test(pw)).length
    if (types === 4) s += 10
    if (/(.)\1{3,}/.test(pw)) s -= 10
    if (/^[a-zA-Z]+$/.test(pw) || /^\d+$/.test(pw)) s -= 10
    return Math.max(0, Math.min(100, s))
  }

  function validate(password) {
    if (!password) return { valid: false, strength: 'empty', percent: 0, issues: [] }
    const issues = []
    if (password.length < 12)                                              issues.push('At least 12 characters')
    if (!/[A-Z]/.test(password))                                           issues.push('1 uppercase letter (A–Z)')
    if (!/[0-9]/.test(password))                                           issues.push('1 number (0–9)')
    if (!/[!@#$%^&*()\-_=+\[\]{};:"'\\|,.<>/?`~]/.test(password))        issues.push('1 special character (!@#$…)')
    if (COMMON.has(password.toLowerCase()))                                issues.push('Too common — choose a unique password')
    const percent = getPercent(password)
    const strength = percent < 30 ? 'weak' : percent < 55 ? 'fair' : percent < 80 ? 'good' : 'strong'
    return { valid: issues.length === 0 && percent >= 55, strength, percent, issues }
  }

  return { validate, checkPwned }
})
