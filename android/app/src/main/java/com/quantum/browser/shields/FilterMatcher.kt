package com.quantum.browser.shields

/**
 * Pure-Kotlin network filter used by Shields. No Android dependencies, so it is
 * unit-tested on the JVM.
 *
 * Understands the rule formats used by the big public lists:
 *   0.0.0.0 ads.example.com      (hosts file)
 *   127.0.0.1 ads.example.com    (hosts file)
 *   ads.example.com              (plain domain list)
 *   ||ads.example.com^           (Adblock Plus / uBlock / Brave network rule)
 *   ||ads.example.com^$third-party
 *   @@||cdn.example.com^         (exception / allow rule)
 * Cosmetic rules (##), regex rules and path rules are ignored on purpose:
 * domain-level blocking is fast enough to run on every request.
 */
class FilterMatcher {

    enum class Mode { OFF, STANDARD, AGGRESSIVE }

    private val blocked = HashSet<String>()
    private val blockedThirdPartyOnly = HashSet<String>()
    private val allowed = HashSet<String>()

    val size: Int get() = blocked.size + blockedThirdPartyOnly.size

    fun clear() {
        blocked.clear(); blockedThirdPartyOnly.clear(); allowed.clear()
    }

    /** Parses a whole list. Returns the number of rules that were added. */
    fun addList(text: String): Int {
        var added = 0
        text.lineSequence().forEach { if (addRule(it)) added++ }
        return added
    }

    fun addRule(raw: String): Boolean {
        var line = raw.trim()
        if (line.isEmpty() || line[0] == '!' || line[0] == '#' || line[0] == '[') return false
        if (line.contains("##") || line.contains("#@#") || line.contains("#?#")) return false

        // hosts-file format
        if (line.startsWith("0.0.0.0 ") || line.startsWith("127.0.0.1 ") || line.startsWith("0.0.0.0\t") || line.startsWith("127.0.0.1\t")) {
            val host = line.split(Regex("\\s+")).getOrNull(1)?.substringBefore('#')?.trim() ?: return false
            return addDomain(blocked, host)
        }

        val exception = line.startsWith("@@")
        if (exception) line = line.substring(2)

        var thirdPartyOnly = false
        val dollar = line.indexOf('$')
        if (dollar >= 0) {
            val options = line.substring(dollar + 1).split(',')
            // Rules restricted to specific resource types/domains are too narrow for host blocking.
            if (options.any { it != "third-party" && it != "3p" && it != "important" }) return false
            thirdPartyOnly = options.any { it == "third-party" || it == "3p" }
            line = line.substring(0, dollar)
        }

        val host: String = when {
            line.startsWith("||") -> {
                val body = line.substring(2)
                val end = body.indexOfFirst { it == '^' || it == '/' || it == '*' || it == ':' }
                if (end >= 0) {
                    // "||host^" or "||host/" only; anything with a path is a path rule.
                    val rest = body.substring(end)
                    if (rest != "^" && rest != "/" && rest != "^|") return false
                    body.substring(0, end)
                } else body
            }
            !exception && isPlainDomain(line) -> line
            else -> return false
        }

        return when {
            exception -> addDomain(allowed, host)
            thirdPartyOnly -> addDomain(blockedThirdPartyOnly, host)
            else -> addDomain(blocked, host)
        }
    }

    private fun addDomain(set: HashSet<String>, host: String): Boolean {
        val h = host.lowercase().trimEnd('.')
        if (!isPlainDomain(h) || h == "localhost" || h == "local" || h == "0.0.0.0") return false
        return set.add(h)
    }

    /**
     * Decide whether a sub-resource request should be blocked.
     * @param requestHost host of the request being made
     * @param pageHost host of the top-level page (null if unknown)
     */
    fun shouldBlock(requestHost: String, pageHost: String?, mode: Mode): Boolean {
        if (mode == Mode.OFF) return false
        val host = requestHost.lowercase()
        if (matches(allowed, host)) return false

        val thirdParty = pageHost == null || !isSameSite(host, pageHost.lowercase())
        // Standard mode (Brave's default) leaves first-party requests alone so sites keep working.
        if (!thirdParty && mode == Mode.STANDARD) return false

        if (matches(blocked, host)) return true
        return thirdParty && matches(blockedThirdPartyOnly, host)
    }

    private fun matches(set: HashSet<String>, host: String): Boolean {
        if (set.isEmpty()) return false
        var h = host
        while (true) {
            if (set.contains(h)) return true
            val dot = h.indexOf('.')
            if (dot < 0 || dot == h.length - 1) return false
            h = h.substring(dot + 1)
        }
    }

    companion object {
        private val DOMAIN = Regex("^[a-z0-9_-]+(\\.[a-z0-9_-]+)+$", RegexOption.IGNORE_CASE)

        /** Common two-label public suffixes, enough to keep "x.co.uk" and "y.co.uk" apart. */
        private val TWO_LEVEL_SUFFIXES = setOf(
            "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.in", "net.in",
            "org.in", "gov.in", "co.jp", "ne.jp", "or.jp", "com.br", "com.cn", "com.sg", "com.my",
            "co.nz", "co.za", "com.mx", "com.tr", "co.kr", "com.tw", "com.hk", "com.sa", "com.eg",
            "com.pk", "com.ng", "co.id", "com.ar", "com.co", "lk", "com.lk", "github.io", "blogspot.com",
            "appspot.com", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "web.app",
        )

        fun isPlainDomain(s: String): Boolean = s.length in 3..253 && DOMAIN.matches(s)

        /** eTLD+1 approximation. */
        fun registrableDomain(host: String): String {
            val labels = host.lowercase().trimEnd('.').split('.')
            if (labels.size <= 2) return labels.joinToString(".")
            val lastTwo = labels.takeLast(2).joinToString(".")
            val take = if (lastTwo in TWO_LEVEL_SUFFIXES) 3 else 2
            return labels.takeLast(take).joinToString(".")
        }

        fun isSameSite(a: String, b: String): Boolean = registrableDomain(a) == registrableDomain(b)
    }
}
