/**
 * Twitter Listener Service
 * Simulates social media monitoring with mock data for testing
 * Structure ready for real Twitter API integration
 */

interface MockSocialSignal {
    postId: string;
    author: string;
    authorHandle: string;
    content: string;
    language: string;
    location?: string;
    hashtags: string[];
    mentions: string[];
    urls: string[];
    engagement: {
        likes: number;
        retweets: number;
        replies: number;
    };
    postedAt: Date;
}

export class TwitterListener {
    /**
     * Generate mock social signals for testing
     * In production, this would call Twitter API
     */
    static generateMockSignals(): MockSocialSignal[] {
        const signals: MockSocialSignal[] = [
            {
                postId: "mock_1",
                author: "Saudi Ministry of Health",
                authorHandle: "@SaudiMOH",
                content: "⚠️ تنبيه صحي: تسجيل 15 حالة إصابة بإنفلونزا الطيور (H5N1) في المنطقة الشرقية. الوضع تحت المراقبة المستمرة. جميع الإجراءات الوقائية مفعلة.",
                language: "ar",
                location: "Riyadh, Saudi Arabia",
                hashtags: ["صحة", "إنفلونزا_الطيور", "الصحة_العامة"],
                mentions: ["@KSACDC"],
                urls: ["https://moh.gov.sa/avian-flu-alert"],
                engagement: { likes: 1247, retweets: 892, replies: 234 },
                postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
            },
            {
                postId: "mock_2",
                author: "WHO EMRO",
                authorHandle: "@WHOEMRO",
                content: "WHO Eastern Mediterranean Regional Office monitoring cholera outbreak in Yemen (127 confirmed cases, 8 deaths). Enhanced surveillance advised for neighboring GCC states due to risk of cross-border transmission. Full report: [link]",
                language: "en",
                location: "Cairo, Egypt",
                hashtags: ["cholera", "Yemen", "PublicHealth", "EMRO"],
                mentions: ["@WHO", "@UNYemen"],
                urls: ["https://who.int/emro/cholera-yemen-2026"],
                engagement: { likes: 2341, retweets: 1567, replies: 445 },
                postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
            },
            {
                postId: "mock_3",
                author: "Isaac Bogoch",
                authorHandle: "@BogochIsaac",
                content: "Concerning trend: MERS-CoV cases increasing in Saudi Arabia this Hajj season. Genomic sequencing reveals new variant with enhanced transmissibility. Healthcare facilities on high alert. Thread 🧵",
                language: "en",
                location: "Toronto, Canada",
                hashtags: ["MERS", "SaudiArabia", "Hajj2026", "InfectiousDiseases"],
                mentions: ["@SaudiMOH", "@WHO"],
                urls: [],
                engagement: { likes: 4532, retweets: 2891, replies: 1023 },
                postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
            },
            {
                postId: "mock_4",
                author: "Eyad Qurabi",
                authorHandle: "@Eyaaaad",
                content: "🚨 Breaking: Reports of dengue fever outbreak in Jeddah. Local hospitals receiving unusually high number of cases. Ministry of Health yet to release official statement. Stay vigilant. #السعودية #صحة",
                language: "en",
                location: "Jeddah, Saudi Arabia",
                hashtags: ["السعودية", "صحة", "DengueFever", "Jeddah"],
                mentions: ["@SaudiMOH"],
                urls: [],
                engagement: { likes: 892, retweets: 445, replies: 178 },
                postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
            },
            {
                postId: "mock_5",
                author: "Saudi News 50",
                authorHandle: "@SaudiNews50",
                content: "عاجل | وزارة الصحة تطلق حملة تطعيم طارئة ضد الحصبة في منطقة مكة المكرمة بعد تسجيل 23 حالة خلال الأسبوع الماضي. الحملة تستهدف 50000 شخص.",
                language: "ar",
                location: "Mecca, Saudi Arabia",
                hashtags: ["عاجل", "السعودية", "تطعيم", "الحصبة"],
                mentions: ["@SaudiMOH"],
                urls: ["https://saudinews50.com/measles-campaign"],
                engagement: { likes: 1567, retweets: 934, replies: 289 },
                postedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
            },
            {
                postId: "mock_6",
                author: "CDC",
                authorHandle: "@CDCgov",
                content: "CDC monitoring avian influenza A(H5N1) activity globally. Recent detections in poultry farms across Middle East region. Risk to general public remains low but vigilance advised for those with occupational exposure.",
                language: "en",
                location: "Atlanta, USA",
                hashtags: ["H5N1", "AvianFlu", "PublicHealth"],
                mentions: ["@WHO"],
                urls: ["https://cdc.gov/h5n1-update"],
                engagement: { likes: 3421, retweets: 2134, replies: 567 },
                postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
            },
            {
                postId: "mock_7",
                author: "Collin Rugg",
                authorHandle: "@CollinRugg",
                content: "BREAKING: New respiratory illness spreading rapidly in East Asia. Hospitals overwhelmed. WHO calling emergency meeting. This could be serious. 🚨",
                language: "en",
                location: "United States",
                hashtags: ["Breaking", "WHO", "HealthAlert"],
                mentions: ["@WHO"],
                urls: [],
                engagement: { likes: 8934, retweets: 5621, replies: 2341 },
                postedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
            },
            {
                postId: "mock_8",
                author: "ProMED",
                authorHandle: "@ProMED_mail",
                content: "PRO/AH/EDR> Cholera - Yemen (03): (multiple provinces) WHO, spread, RFI\nA cholera outbreak continues in Yemen with 127 confirmed cases and 8 deaths reported. Geographic spread raises regional concerns.",
                language: "en",
                location: "Global",
                hashtags: ["ProMED", "Cholera", "Yemen", "OutbreakAlert"],
                mentions: ["@WHO", "@WHOEMRO"],
                urls: ["https://promedmail.org/cholera-yemen-03"],
                engagement: { likes: 1892, retweets: 1234, replies: 345 },
                postedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
            },
        ];

        return signals;
    }

    /**
     * Calculate relevance score based on multiple factors
     */
    static calculateRelevanceScore(
        signal: MockSocialSignal,
        accountPriority: number,
        keywordMatches: string[]
    ): number {
        // Account priority score (0-40 points)
        const accountScore = accountPriority === 1 ? 40 : accountPriority === 2 ? 25 : 10;

        // Keyword match score (0-30 points)
        let keywordScore = 0;
        const criticalKeywords = ["outbreak", "emergency", "deaths", "alert", "H5N1", "MERS", "cholera", "تفشي", "وباء", "وفيات"];
        const gccLocations = ["Saudi Arabia", "UAE", "Qatar", "Kuwait", "Bahrain", "Oman", "GCC", "السعودية", "الخليج"];

        const hasCriticalKeyword = keywordMatches.some(k => criticalKeywords.includes(k));
        const hasGCCLocation = keywordMatches.some(k => gccLocations.includes(k)) ||
            gccLocations.some(loc => signal.content.includes(loc) || signal.location?.includes(loc));

        if (hasCriticalKeyword && hasGCCLocation) keywordScore = 30;
        else if (hasCriticalKeyword || hasGCCLocation) keywordScore = 20;
        else if (keywordMatches.length > 0) keywordScore = 10;

        // Engagement score (0-20 points)
        const totalEngagement = signal.engagement.likes + signal.engagement.retweets * 2 + signal.engagement.replies;
        const engagementScore = Math.min(20, Math.log10(totalEngagement + 1) * 4);

        // Recency score (0-10 points)
        const hoursAgo = (Date.now() - signal.postedAt.getTime()) / (1000 * 60 * 60);
        let recencyScore = 10;
        if (hoursAgo > 24) recencyScore = 2;
        else if (hoursAgo > 6) recencyScore = 5;
        else if (hoursAgo > 1) recencyScore = 7;

        const totalScore = accountScore + keywordScore + engagementScore + recencyScore;
        return Math.min(100, Math.round(totalScore * 100) / 100);
    }

    /**
     * Get mock account priority
     */
    static getAccountPriority(handle: string): number {
        const tier1 = ["@WHO", "@WHOEMRO", "@SaudiMOH", "@KSACDC", "@CDCgov", "@ProMED_mail"];
        const tier2 = ["@BogochIsaac", "@SaudiNews50", "@Eyaaaad", "@CollinRugg", "@ECDC_EU"];

        if (tier1.includes(handle)) return 1;
        if (tier2.includes(handle)) return 2;
        return 3;
    }

    /**
     * Detect keywords in content
     */
    static detectKeywords(content: string): string[] {
        const keywords = [
            "outbreak", "epidemic", "pandemic", "H5N1", "MERS", "cholera", "dengue", "measles",
            "emergency", "alert", "deaths", "cases", "Saudi Arabia", "GCC", "Yemen", "Hajj",
            "تفشي", "وباء", "جائحة", "وفيات", "حالات", "السعودية", "طوارئ", "تنبيه"
        ];

        return keywords.filter(k => content.toLowerCase().includes(k.toLowerCase()));
    }
}
