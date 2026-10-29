"""Versioned consent notice (roadmap Section 8.2).

TEMPLATE TEXT - must be reviewed by the college's legal / data-protection officer (DPDP Act 2023)
before collecting any real facial data. Bump CONSENT_VERSION whenever the text changes; students
are then asked to consent again.
"""

CONSENT_VERSION = "2026-10-v1"

CONSENT_NOTICE = {
    "version": CONSENT_VERSION,
    "title": "Face verification for attendance",
    "sections": [
        {
            "heading": "What is collected",
            "body": "A few photos of your face taken during enrollment, and a mathematical face template "
            "(a list of numbers) calculated from them. Photos are discarded immediately after the template is made.",
        },
        {
            "heading": "Why",
            "body": "Only to check that it is really you when you mark attendance. It is never used for any other purpose.",
        },
        {
            "heading": "How it is processed",
            "body": "Matching happens on the college's server. Photos taken while marking attendance are processed in "
            "memory and not stored. No third party receives your face data.",
        },
        {
            "heading": "How it is protected",
            "body": "Your template is encrypted and kept separately from other records. Access is limited to the "
            "verification service and is logged. Teachers never see your face data or match results.",
        },
        {
            "heading": "How long it is kept",
            "body": "Until you withdraw consent, graduate or leave the college, and then deleted within 30 days. "
            "Verification results (decision and time) are kept for 90 days.",
        },
        {
            "heading": "Your choices",
            "body": "You may refuse or withdraw consent at any time without penalty. You can then mark attendance "
            "through teacher verification. You can re-enrol or delete your face data from the Enrollment screen.",
        },
        {
            "heading": "Contact",
            "body": "Questions or complaints: the college Data Protection Officer.",
        },
    ],
}
