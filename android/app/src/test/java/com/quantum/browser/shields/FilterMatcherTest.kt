package com.quantum.browser.shields

import com.quantum.browser.shields.FilterMatcher.Mode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterMatcherTest {

    private fun matcher(vararg rules: String) = FilterMatcher().apply { rules.forEach { addRule(it) } }

    @Test fun hostsFileLineBlocksDomainAndSubdomains() {
        val m = matcher("0.0.0.0 doubleclick.net")
        assertTrue(m.shouldBlock("doubleclick.net", "news.com", Mode.STANDARD))
        assertTrue(m.shouldBlock("ad.g.doubleclick.net", "news.com", Mode.STANDARD))
        assertFalse(m.shouldBlock("notdoubleclick.net", "news.com", Mode.STANDARD))
    }

    @Test fun adblockNetworkRuleIsParsed() {
        val m = matcher("||adservice.google.com^")
        assertTrue(m.shouldBlock("adservice.google.com", "example.org", Mode.STANDARD))
        assertFalse(m.shouldBlock("google.com", "example.org", Mode.STANDARD))
    }

    @Test fun exceptionRuleWins() {
        val m = matcher("||tracker.com^", "@@||cdn.tracker.com^")
        assertTrue(m.shouldBlock("pixel.tracker.com", "site.com", Mode.AGGRESSIVE))
        assertFalse(m.shouldBlock("cdn.tracker.com", "site.com", Mode.AGGRESSIVE))
    }

    @Test fun standardModeSparesFirstPartyAggressiveDoesNot() {
        val m = matcher("||metrics.shop.com^")
        assertFalse(m.shouldBlock("metrics.shop.com", "www.shop.com", Mode.STANDARD))
        assertTrue(m.shouldBlock("metrics.shop.com", "www.shop.com", Mode.AGGRESSIVE))
    }

    @Test fun thirdPartyOptionOnlyBlocksCrossSite() {
        val m = matcher("||widgets.social.com^\$third-party")
        assertTrue(m.shouldBlock("widgets.social.com", "blog.net", Mode.AGGRESSIVE))
        assertFalse(m.shouldBlock("widgets.social.com", "www.social.com", Mode.AGGRESSIVE))
    }

    @Test fun offModeNeverBlocks() {
        assertFalse(matcher("ads.com").shouldBlock("ads.com", "x.com", Mode.OFF))
    }

    @Test fun ignoresCosmeticCommentsAndPathRules() {
        val m = FilterMatcher()
        assertEquals(0, m.addList("! comment\n# hosts comment\nexample.com##.ad\n||example.com/ads/*\n/banner/*\n||img.com^\$image"))
        assertEquals(0, m.size)
    }

    @Test fun registrableDomainHandlesTwoLevelSuffixes() {
        assertEquals("bbc.co.uk", FilterMatcher.registrableDomain("www.news.bbc.co.uk"))
        assertEquals("google.com", FilterMatcher.registrableDomain("mail.google.com"))
        assertFalse(FilterMatcher.isSameSite("a.co.uk", "b.co.uk"))
        assertTrue(FilterMatcher.isSameSite("m.youtube.com", "youtube.com"))
    }

    @Test fun rejectsJunkHosts() {
        val m = FilterMatcher()
        assertFalse(m.addRule("0.0.0.0 localhost"))
        assertFalse(m.addRule("0.0.0.0 0.0.0.0"))
        assertFalse(m.addRule("not a domain"))
        assertTrue(m.addRule("127.0.0.1 tracker.io # inline comment"))
    }
}
