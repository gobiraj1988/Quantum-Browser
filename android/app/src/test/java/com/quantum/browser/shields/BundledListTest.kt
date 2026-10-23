package com.quantum.browser.shields

import com.quantum.browser.shields.FilterMatcher.Mode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Guards the starter list shipped in assets/ (Gradle runs unit tests from the module directory). */
class BundledListTest {

    private val matcher = FilterMatcher().apply { addList(File("src/main/assets/blocklist.txt").readText()) }

    @Test fun everyRuleInTheStarterListParses() {
        val rules = File("src/main/assets/blocklist.txt").readLines().count { it.startsWith("||") }
        assertTrue("only ${matcher.size} of $rules rules parsed", matcher.size == rules)
    }

    @Test fun blocksMajorAdAndTrackerNetworks() {
        listOf("securepubads.g.doubleclick.net", "pagead2.googlesyndication.com", "www.google-analytics.com",
            "static.hotjar.com", "connect.facebook.net", "cdn.taboola.com").forEach {
            assertTrue(it, matcher.shouldBlock(it, "news-site.com", Mode.STANDARD))
        }
    }

    @Test fun neverBlocksBreakageAllowlist() {
        listOf("fonts.gstatic.com", "ajax.googleapis.com", "www.recaptcha.net", "challenges.cloudflare.com").forEach {
            assertFalse(it, matcher.shouldBlock(it, "news-site.com", Mode.AGGRESSIVE))
        }
    }

    @Test fun firstPartyTagManagerAllowedInStandard() {
        assertFalse(matcher.shouldBlock("www.googletagmanager.com", "googletagmanager.com", Mode.STANDARD))
    }
}
