// ==UserScript==
// @name         Data Matches for StashResults
// @namespace    http://kennyg.com/
// @version      1.19.5
// @description  Highlights components of the matches from StashBox
// @author       KennyG
// @match        *://192.168.1.201:9999/scenes*
// @match        *://192.168.1.201:9999/groups*
// @match        *://192.168.1.201:9999/performers*
// @grant        none
// @run-at       document-end
// @icon         https://raw.githubusercontent.com/stashapp/stash/develop/ui/v2.5/public/favicon.png
// ==/UserScript==

(function () {
    'use strict';

    // Global constant for color
    const HIGHLIGHT_COLOR = '#00796B'; // Teal color
    const VERIFIED_MATCH_BACKGROUND_COLOR = 'rgba(0, 121, 107, 0.5)'; // Same as optional-field-content

    // Alias groups for filename/query-to-entity matching.
    // Add new aliases as additional values in the same group.
    // Example: filename token "t4k" should match entity/studio "Tiny 4K".
    const MATCH_ALIAS_GROUPS = [
        ['t4k', 'Tiny 4K'],
		['tla', 'Teens Love Anal'],
		['18OG', '18 Only Girls']
    ];

    // SVG icon shown when the date/entity is fully verified from the filename
    const VERIFIED_ICON_SVG = '<svg aria-hidden="true" focusable="false" data-prefix="far" data-icon="circle-check" class="svg-inline--fa fa-circle-check fa-icon SceneTaggerIcon" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" color="#0f9960"><path fill="currentColor" d="M243.8 339.8C232.9 350.7 215.1 350.7 204.2 339.8L140.2 275.8C129.3 264.9 129.3 247.1 140.2 236.2C151.1 225.3 168.9 225.3 179.8 236.2L224 280.4L332.2 172.2C343.1 161.3 360.9 161.3 371.8 172.2C382.7 183.1 382.7 200.9 371.8 211.8L243.8 339.8zM512 256C512 397.4 397.4 512 256 512C114.6 512 0 397.4 0 256C0 114.6 114.6 0 256 0C397.4 0 512 114.6 512 256zM256 48C141.1 48 48 141.1 48 256C48 370.9 141.1 464 256 464C370.9 464 464 370.9 464 256C464 141.1 370.9 48 256 48z"></path></svg>';

    // Fingerprint color rules
    const COLOR_RULES = [
        {
            range: [0, 10],
            colors: [
                { threshold: 0.45, color: '#B71C1C' }, // Crimson
                { threshold: 0.60, color: '#FF6F00' }, // Orange800
                { threshold: 1.00, color: '#00796B' }  // Pine Green
            ]
        },
        {
            range: [11, 50],
            colors: [
                { threshold: 0.30, color: '#B71C1C' }, // Crimson
                { threshold: 0.50, color: '#FF6F00' }, // Orange800
                { threshold: 0.75, color: '#BBBE64' }, // Citron
                { threshold: 1.00, color: '#00796B' }  // Pine Green
            ]
        },
        {
            range: [51, Infinity],
            colors: [
                { threshold: 0.20, color: '#B71C1C' }, // Crimson
                { threshold: 0.40, color: '#FF6F00' }, // Orange800
                { threshold: 0.75, color: '#BBBE64' }, // Citron
                { threshold: 1.00, color: '#00796B' }  // Pine Green
            ]
        }
    ];

    function getFingerprintColor(total, percent) {
        for (let rule of COLOR_RULES) {
            if (total >= rule.range[0] && total <= rule.range[1]) {
                for (let i = 0; i < rule.colors.length; i++) {
                    if (percent <= rule.colors[i].threshold) {
                        return rule.colors[i].color;
                    }
                }
            }
        }
        return '';
    }

    // Function to check if date components (YY, MM, DD) are found in the title.
    // Keep the old partial-match behavior from 1.19, but do NOT match date parts
    // inside unrelated longer numbers. For example, 2014-10-14 must not match
    // filename/query "21.08.14_1080" just because "10" exists inside "1080".
    function checkDateInTitle(dateText, titleText) {
        const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) return false;

        const [, year, searchMM, searchDD] = dateMatch;
        const searchYY = year.slice(2); // Get the last two digits of the year (YY)
        const components = [searchYY, searchMM, searchDD];

        // Extract numeric tokens from the filename/query. This makes "10" match
        // only a standalone numeric token "10", not the first two digits of "1080".
        const numberTokens = (titleText.match(/\d+/g) || []).slice();
        if (numberTokens.length === 0) return false;

        // Consume tokens one by one so repeated components, e.g. 14-10-14,
        // require enough real occurrences in the filename/query.
        return components.every(component => {
            const index = numberTokens.findIndex(token => token === component);
            if (index === -1) return false;
            numberTokens.splice(index, 1);
            return true;
        });
    }

    // Check for year-only partial date match from filenames like:
    // "Dakota Tyler - [Tiny4K.com] - [2022] - Tiny Temptation.mp4".
    // The bracketed year is treated as a real production/release year and can
    // partially match result dates such as "2022-05-17". This intentionally
    // requires square/round brackets so random numbers in filenames do not
    // become date evidence.
    function isYearPartiallyMatched(dateText, titleText) {
        const dateMatch = dateText.match(/^(\d{4})-\d{2}-\d{2}$/);
        if (!dateMatch) return false;

        const year = dateMatch[1];
        const escapedYear = year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const bracketedYearPattern = new RegExp(`[\\[\\(]\\s*${escapedYear}\\s*[\\]\\)]`);

        return bracketedYearPattern.test(titleText || '');
    }

    // Function to check for a fully verified date pattern in the title.
    // e.g. dateText "2021-08-05" matches:
    // - "21.08.05", "21-08-05", "21 08 05", or "210805"
    // - "2021.08.05", "2021-08-05", or "2021 08 05"
    // - European filename dates like "05.08.2021", "05-08-2021", or "05 08 2021"
    function isDateVerified(dateText, titleText) {
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return false;

        const [, year, mm, dd] = match;
        const yy = year.slice(2);

        // Allow common delimiters between parts, and don't require strict \b at the left,
        // because filenames often have an underscore or letter before the year.
        const patterns = [
            // YY.MM.DD, YY-MM-DD, YY MM DD
            new RegExp(`${yy}[.\\- ]${mm}[.\\- ]${dd}`),
            // YYYY.MM.DD, YYYY-MM-DD, YYYY MM DD
            new RegExp(`${year}[.\\- ]${mm}[.\\- ]${dd}`),
            // DD.MM.YYYY, DD-MM-YYYY, DD MM YYYY
            new RegExp(`${dd}[.\\- ]${mm}[.\\- ]${year}`),
            // YYMMDD
            new RegExp(`${yy}${mm}${dd}`),
            // DDMMYYYY
            new RegExp(`${dd}${mm}${year}`)
        ];

        const haystack = titleText || '';
        return patterns.some(re => re.test(haystack));
    }

    function highlightField(fieldObject){
        fieldObject.style.backgroundColor = HIGHLIGHT_COLOR; // Teal
        fieldObject.style.color = '#FFFFFF';
        const anchorTag = fieldObject.querySelector('a');
        if (anchorTag) {
            anchorTag.style.color = '#FFFFFF'; // Change anchor text color to white
        }
    }

    // Highlight fields that were verified from the filename.
    // Uses the same visible style as Stash's "optional-field-content" matched block.
    function highlightVerifiedMatch(fieldObject) {
        if (!fieldObject) return;

        fieldObject.style.backgroundColor = VERIFIED_MATCH_BACKGROUND_COLOR;
        fieldObject.style.color = '#FFFFFF';
        fieldObject.style.borderRadius = '0.25rem';
        fieldObject.style.padding = '0.15rem 0.35rem';

        fieldObject.querySelectorAll('a').forEach(anchorTag => {
            anchorTag.style.color = '#FFFFFF';
        });
    }

    // Append a verified icon to the given field if not already present.
    // Optional tooltipText allows different explanations (date vs entity match).
    // We wrap the SVG in a small div so the hover target for the tooltip is larger
    // and easier to hit with the mouse.
    function addVerifiedIcon(fieldObject, tooltipText) {
        if (!fieldObject) return;
        // Avoid adding multiple icons
        if (fieldObject.querySelector('.SceneTaggerIcon')) {
            return;
        }

        const container = document.createElement('div');
        container.style.display = 'inline-block';
        container.style.marginLeft = '0.35rem';
        container.title = tooltipText || 'Verified match with filename';

        container.innerHTML = VERIFIED_ICON_SVG;
        fieldObject.appendChild(container);
    }

    function multiHighlight(fieldObj, targetText)
    {

        const fieldText = fieldObj.textContent.trim().toLowerCase();
        const target = targetText.trim().toLowerCase();
        const fieldWords = fieldText.split(/\s+/); //split whitespace
        let matchCount = 0;

        fieldWords.forEach(word => {
           if (target.includes(word)) {
               matchCount++;
           }
        });

        const matchPercentage = (matchCount / fieldWords.length) * 100;
        const opacity = Math.min(matchPercentage, 100); // Limit opacity to 100%

        // Apply the highlight with calculated opacity
        fieldObj.style.backgroundColor = `rgba(${parseInt(HIGHLIGHT_COLOR.slice(1, 3), 16)}, ${parseInt(HIGHLIGHT_COLOR.slice(3, 5), 16)}, ${parseInt(HIGHLIGHT_COLOR.slice(5, 7), 16)}, ${opacity / 100})`;
        fieldObj.style.color = '#FFFFFF'; // White text
    }

    function applyVerifiedSpanStyle(span) {
        span.style.backgroundColor = VERIFIED_MATCH_BACKGROUND_COLOR;
        span.style.color = '#FFFFFF';
        span.style.borderRadius = '0.25rem';
        span.style.padding = '0.15rem 0.35rem';
        span.style.display = 'inline-block';
    }

    function createTextSpan(text, isMatched, tooltipText) {
        const span = document.createElement('span');
        span.textContent = text;
        if (isMatched) {
            applyVerifiedSpanStyle(span);
            if (tooltipText) {
                span.title = tooltipText;
            }
        }
        return span;
    }

    function getSceneMetadataParts(text) {
        const dateMatch = (text || '').match(/\b\d{4}-\d{2}-\d{2}\b/);
        if (!dateMatch) {
            return {
                textPart: (text || '').trim(),
                separatorPart: '',
                datePart: ''
            };
        }

        const datePart = dateMatch[0];
        const beforeDate = text.slice(0, dateMatch.index);
        const afterDate = text.slice(dateMatch.index + datePart.length);

        // The usual form is "Studio • YYYY-MM-DD". Keep the separator unhighlighted
        // so studio/site and date can show independent match states.
        const separatorMatch = beforeDate.match(/\s*[•|\-–—]\s*$/);
        const separatorPart = separatorMatch ? separatorMatch[0] : '';
        const textPart = beforeDate.slice(0, beforeDate.length - separatorPart.length).trim();

        return {
            textPart,
            separatorPart,
            datePart,
            afterDate
        };
    }

    function clearSceneMetadataContainerHighlight(field) {
        // Older versions highlighted the whole h5. Newer versions highlight only
        // the matched sub-parts, so clear our old container-level inline style.
        field.style.backgroundColor = '';
        field.style.color = '';
        field.style.borderRadius = '';
        field.style.padding = '';
    }

    // Highlight metadata rendered as a compact header, for example:
    // <div class="scene-metadata"><h5>Tiny 4K • 2014-10-14</h5></div>
    // Studio/site text and date are evaluated independently. This prevents a line
    // like "Tiny 4K • 2014-10-14" from being highlighted as one whole block when
    // only the alias "t4k" matches the filename/query.
    function highlightSceneMetadataDates(searchItem, sourceText) {
        const metadataFields = searchItem.querySelectorAll('.scene-metadata h5');

        metadataFields.forEach(field => {
            clearSceneMetadataContainerHighlight(field);

            // If Stash rendered a real optional-field inside h5, leave that component
            // alone. It is already handled by the optional-field-content code path.
            if (field.querySelector('.optional-field')) return;

            if (!field.dataset.dmhOriginalText) {
                field.dataset.dmhOriginalText = field.textContent || '';
            }

            const originalText = field.dataset.dmhOriginalText;
            const parts = getSceneMetadataParts(originalText);
            const textMatched = !!parts.textPart && isTextMatchedBySource(parts.textPart, sourceText);
            const dateMatched = !!parts.datePart && (
                isDateVerified(parts.datePart, sourceText) ||
                checkDateInTitle(parts.datePart, sourceText) ||
                isYearPartiallyMatched(parts.datePart, sourceText)
            );

            const signature = [originalText, sourceText, textMatched ? 'T1' : 'T0', dateMatched ? 'D1' : 'D0'].join('::');
            if (field.dataset.dmhSceneMetadataSignature === signature) return;
            field.dataset.dmhSceneMetadataSignature = signature;

            field.textContent = '';

            if (parts.textPart) {
                field.appendChild(createTextSpan(
                    parts.textPart,
                    textMatched,
                    textMatched ? 'Text/studio found in filename or alias dictionary' : ''
                ));
            }

            if (parts.separatorPart) {
                field.appendChild(document.createTextNode(parts.separatorPart));
            } else if (parts.textPart && parts.datePart) {
                field.appendChild(document.createTextNode(' '));
            }

            if (parts.datePart) {
                const dateSpan = createTextSpan(
                    parts.datePart,
                    dateMatched,
                    dateMatched ? 'Date match in filename' : ''
                );
                field.appendChild(dateSpan);
            }

            if (parts.afterDate) {
                field.appendChild(document.createTextNode(parts.afterDate));
            }
        });
    }

    // Highlight fingerprint ratio lines by generic "X/Y" pattern only.
    // This is language-independent and does not rewrite DOM/text nodes,
    // so it is safe to run from MutationObserver without causing update loops.
    function highlightFingerprints() {
        const matchDivs = document.querySelectorAll('div.font-weight-bold');

        matchDivs.forEach(div => {
            const text = div.textContent || '';
            const match = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (!match) return;

            const matched = parseInt(match[1], 10);
            const total = parseInt(match[2], 10);
            if (!Number.isFinite(matched) || !Number.isFinite(total) || total <= 0) return;

            const percent = matched / total;
            const color = getFingerprintColor(total, percent);
            if (!color) return;

            div.style.backgroundColor = color;
            div.style.color = '#FFFFFF';
            div.style.borderRadius = '0.25rem';
            div.style.padding = '0.15rem 0.35rem';
        });
    }


    // Normalize text for lightweight filename/entity comparisons.
    function normalizeForCompare(value) {
        return (value || '')
            .toLowerCase()
            .replace(/'/g, '')
            .trim();
    }

    // Stronger normalization for comparing StashBox entity names with local Stash
    // matched names. This ignores punctuation like !, dots, hyphens, underscores
    // and multiple spaces, so "Not My Grandpa!" and "Not My Grandpa" match.
    function normalizeForLooseCompare(value) {
        return normalizeForCompare(value)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function getAliasGroupValues(value) {
        const valueLoose = normalizeForLooseCompare(value);
        if (!valueLoose) return [];

        const aliases = new Set();
        MATCH_ALIAS_GROUPS.forEach(group => {
            const groupLooseValues = group.map(item => normalizeForLooseCompare(item)).filter(Boolean);
            if (groupLooseValues.includes(valueLoose)) {
                group.forEach(item => {
                    if (item) aliases.add(item);
                });
            }
        });

        return Array.from(aliases);
    }

    function buildTextMatchCandidates(value) {
        const normalizedValue = normalizeForCompare(value);
        const values = [normalizedValue, ...getAliasGroupValues(normalizedValue)];
        const candidates = new Set();

        values.forEach(item => {
            const normalizedItem = normalizeForCompare(item);
            const looseItem = normalizeForLooseCompare(item);
            if (!normalizedItem && !looseItem) return;

            if (normalizedItem) {
                candidates.add(normalizedItem);
                candidates.add(normalizedItem.replace(/\s+/g, ''));
                candidates.add(normalizedItem.replace(/\s+/g, '.'));
                candidates.add(normalizedItem.replace(/\s+/g, '_'));
                candidates.add(normalizedItem.replace(/\s+/g, '-'));
            }

            if (looseItem) {
                candidates.add(looseItem);
            }
        });

        return Array.from(candidates).filter(Boolean);
    }

    function areNamesEquivalent(left, right) {
        const leftLoose = normalizeForLooseCompare(left);
        const rightLoose = normalizeForLooseCompare(right);
        return !!leftLoose && !!rightLoose && leftLoose === rightLoose;
    }

    function isTextMatchedBySource(value, sourceText) {
        const normalizedSource = normalizeForCompare(sourceText);
        if (!value || !normalizedSource) return false;

        const candidates = buildTextMatchCandidates(value);
        if (candidates.length === 0) return false;

        const looseSource = normalizeForLooseCompare(normalizedSource);
        return candidates.some(candidate =>
            candidate && (normalizedSource.includes(candidate) || looseSource.includes(candidate))
        );
    }

    function getEntityFieldValue(field) {
        if (!field) return '';

        const anchor = field.querySelector('b a, b span a, a');
        const anchorText = anchor && anchor.textContent ? anchor.textContent.trim() : '';
        if (anchorText) {
            return anchorText.replace(/\s*\(.*?\)\s*$/, '').trim();
        }

        const parts = (field.textContent || '').split(':');
        if (parts.length < 2) return '';

        return parts.slice(1).join(':').replace(/\s*\(.*?\)\s*$/, '').trim();
    }

    function getEntityMatchLabel(field) {
        const text = field && field.textContent ? field.textContent : '';
        return text.includes(':') ? text.split(':')[0].trim() : 'Entity';
    }

    function isLocalMatchedText(value) {
        return /^\s*(Matched|Совпавший)\s*:/i.test(value || '');
    }

    function getBackgroundAlpha(element) {
        if (!element) return 0;

        const backgroundColor = (
            element.style.backgroundColor ||
            window.getComputedStyle(element).backgroundColor ||
            ''
        ).trim().toLowerCase();

        if (!backgroundColor || backgroundColor === 'transparent') return 0;

        const rgbaMatch = backgroundColor.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
        if (rgbaMatch) {
            const alpha = parseFloat(rgbaMatch[1]);
            return Number.isFinite(alpha) ? alpha : 0;
        }

        const rgbMatch = backgroundColor.match(/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/);
        return rgbMatch ? 1 : 0;
    }

    function isVisiblyHighlightedField(element) {
        // Treat rgba(..., 0) as NOT highlighted. This prevents local "Совпавший"
        // blocks with transparent background from verifying the entity name.
        return getBackgroundAlpha(element) > 0.05;
    }

    function getLocalMatchedValuesNearEntity(field) {
        const row = field.closest('.row');
        const scope = row || field.closest('li.search-result') || field.parentElement;
        if (!scope) return [];

        return Array.from(scope.querySelectorAll('.optional-field.included .optional-field-content'))
            .filter(optionalField => !optionalField.closest('.scene-image-container'))
            .filter(optionalField => isVisiblyHighlightedField(optionalField))
            .map(optionalField => {
                const anchor = optionalField.querySelector('a');
                if (anchor && anchor.textContent) {
                    return anchor.textContent.trim();
                }

                return (optionalField.textContent || '')
                    .replace(/^\s*(Matched|Совпавший)\s*:\s*/i, '')
                    .trim();
            })
            .filter(Boolean);
    }

    function isEntityMatchedLocally(field, entityValue) {
        if (!entityValue) return false;

        return getLocalMatchedValuesNearEntity(field).some(localValue =>
            areNamesEquivalent(entityValue, localValue)
        );
    }

    function countEntityMatches(result, sourceText) {
        let score = 0;

        result.querySelectorAll('.entity-name').forEach(field => {
            const entityValue = getEntityFieldValue(field);
            if (!entityValue) return;

            if (isTextMatchedBySource(entityValue, sourceText)) {
                score += 2;
            }

            // Local Stash match is also a strong signal. It covers cases where the
            // filename does not contain the studio/performer name, but Stash already
            // rendered "Matched/Совпавший" with the same name next to the entity.
            if (isEntityMatchedLocally(field, entityValue)) {
                score += 2;
            }
        });

        return score;
    }

    function countOptionalFieldMatches(result, sourceText) {
        let score = 0;

        result.querySelectorAll('.optional-field.included .optional-field-content').forEach(field => {
            // The preview image is usually present in every result, so it is not useful
            // for deciding which metadata tab/result is the best match.
            if (field.closest('.scene-image-container')) return;

            const value = (field.textContent || '').trim();
            if (!value) return;

            if (isLocalMatchedText(value)) {
                // A local Stash match should influence scoring only when it is visibly
                // highlighted by Stash/our previous checks. Transparent rgba(..., 0)
                // means there was no real filename/query match.
                if (isVisiblyHighlightedField(field)) {
                    score += 1;
                }
                return;
            }

            const isoDateMatch = value.match(/^\d{4}-\d{2}-\d{2}$/);
            if (isoDateMatch) {
                if (isDateVerified(value, sourceText)) {
                    score += 3;
                } else if (checkDateInTitle(value, sourceText)) {
                    score += 2;
                } else if (isYearPartiallyMatched(value, sourceText)) {
                    score += 1.5;
                } else {
                    score += 1;
                }
                return;
            }

            if (isTextMatchedBySource(value, sourceText)) {
                score += 2;
                return;
            }

            // Stash's included optional-field still means the scraper selected this field.
            // Give it a small score even if it is not directly found in the filename.
            score += 1;
        });

        return score;
    }

    function countSceneMetadataDateMatches(result, sourceText) {
        let score = 0;

        result.querySelectorAll('.scene-metadata h5').forEach(field => {
            const text = field.dataset.dmhOriginalText || field.textContent || '';
            const parts = getSceneMetadataParts(text);

            if (parts.textPart && isTextMatchedBySource(parts.textPart, sourceText)) {
                score += 2;
            }

            if (parts.datePart) {
                if (isDateVerified(parts.datePart, sourceText)) {
                    score += 3;
                } else if (checkDateInTitle(parts.datePart, sourceText)) {
                    score += 2;
                } else if (isYearPartiallyMatched(parts.datePart, sourceText)) {
                    score += 1.5;
                }
            }
        });

        return score;
    }

    function countFingerprintAndChecksumMatches(result) {
        let score = 0;

        result.querySelectorAll('div.font-weight-bold').forEach(div => {
            const text = div.textContent || '';
            const ratioMatch = text.match(/(\d+)\s*\/\s*(\d+)/);

            if (ratioMatch) {
                const matched = parseInt(ratioMatch[1], 10);
                const total = parseInt(ratioMatch[2], 10);

                if (Number.isFinite(matched) && Number.isFinite(total) && total > 0) {
                    const percent = Math.max(0, Math.min(1, matched / total));
                    // Ratio is the strongest single indicator, but keep the score bounded.
                    score += percent * 6;
                    score += Math.min(matched, 100) / 100;
                    if (matched === total) score += 1;
                }
                return;
            }

            const hasSuccessIcon = div.querySelector('.SceneTaggerIcon.text-success, .text-success, svg[color="#0f9960"]');
            const hasDangerIcon = div.querySelector('.text-danger, [data-icon="xmark"]');

            if (hasSuccessIcon) score += 1.5;
            if (hasDangerIcon) score -= 1;
        });

        return score;
    }

    function getSearchResultScore(result, sourceText) {
        let score = 0;

        score += countOptionalFieldMatches(result, sourceText);
        score += countEntityMatches(result, sourceText);
        score += countSceneMetadataDateMatches(result, sourceText);
        score += countFingerprintAndChecksumMatches(result);

        return score;
    }

    function getResultActivationSignature(searchResults) {
        return searchResults.map(result => result.className).join('|');
    }

    // Select/expand the best search-result inside each search-item.
    // We click the best result instead of moving DOM nodes, because Stash/React owns the list.
    function activateBestSearchResult(searchItem, sourceText) {
        const searchResults = Array.from(searchItem.querySelectorAll('li.search-result'));
        if (searchResults.length < 2) return;

        const scored = searchResults.map((result, index) => ({
            result,
            index,
            score: getSearchResultScore(result, sourceText)
        }));

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.index - b.index;
        });

        const best = scored[0];
        if (!best || best.score <= 0) return;

        const currentlyActive = searchResults.find(result =>
            result.classList.contains('active') || result.classList.contains('selected-result')
        );

        if (currentlyActive === best.result) return;

        const scoreSignature = scored
            .map(item => `${item.index}:${Math.round(item.score * 100)}`)
            .join('|');
        const activationSignature = getResultActivationSignature(searchResults);
        const signature = `${scoreSignature}::${activationSignature}`;
        const now = Date.now();
        const lastSignature = searchItem.dataset.dmhBestResultActivationSignature || '';
        const lastClickTime = parseInt(searchItem.dataset.dmhBestResultActivationTime || '0', 10);

        // If Stash does not activate the result for some reason, do not click in a tight loop.
        if (lastSignature === signature && now - lastClickTime < 1500) return;

        searchItem.dataset.dmhBestResultActivationSignature = signature;
        searchItem.dataset.dmhBestResultActivationTime = String(now);

        best.result.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    }

    // Function to highlight the date/field/entity matches
    function highlightMatches() {
        let rowcount=0;
        const searchItems = document.querySelectorAll('div.search-item'); // Get all search-item divs
        searchItems.forEach(searchItem => {
            rowcount++
            // Get potential fields (optional-field-content) inside the search-item
            let resultFields = searchItem.querySelectorAll('.optional-field-content');

            // Build the "source" text from the TOP of the card only:
            // [a.scene-link.overflow-hidden] + [text-input form-control].
            // This is the query/filename we want to validate the LOWER metadata against.
            let sourceText = '';
            const sourceLink = searchItem.querySelector('a.scene-link.overflow-hidden');
            if (sourceLink && sourceLink.textContent) {
                sourceText = sourceLink.textContent.trim();
            }

            // Also include the processed query input (global text-input form-control), if present.
            // Stash normalizes this (e.g. prefixes "20" for years, dot→space, etc.),
            // so combining it with the filename text gives the full search "haystack".
            let queryText = '';
            const queryInput = searchItem.querySelector('input.text-input.form-control, input.text-input');
            if (queryInput && typeof queryInput.value === 'string') {
                queryText = queryInput.value.trim();
            }

            if (queryText) {
                sourceText = (sourceText + ' ' + queryText).trim();
            }

            // Debug: show the source string we use as the haystack (top block only)
            //console.log('[DataMatchHighlighter] sourceText:', sourceText);

            // Loop through the date fields and find and highlight the matches
            resultFields.forEach(field => {
                let matchText = field.textContent.trim();

                // Don't process local Stash matched blocks or empty elements.
                // These blocks look like "Matched:" / "Совпавший:" and should not be
                // colored by partial filename matching, especially not with rgba(..., 0).
                if (matchText === "" || isLocalMatchedText(matchText)) {
                    return; // Skip to the next iteration
                }

                let isoDateMatch = field.textContent.match(/^\d{4}-\d{2}-\d{2}$/); // Check for ISO date format (YYYY-MM-DD)
                if (isoDateMatch) {
                    // For dates, we ONLY compare against the top "sourceText" (filename + query).
                    // No self-match is possible because the result date lives in the lower card.
                    const hasComponents = checkDateInTitle(matchText, sourceText);
                    const hasYearOnlyMatch = isYearPartiallyMatched(matchText, sourceText);
                    const verified = isDateVerified(matchText, sourceText);

                    // If we have a fully verified date pattern, skip highlight and just add the icon
                    if (verified) {
                        highlightVerifiedMatch(field);
                        addVerifiedIcon(field, 'Exact date match in filename');
                    }
                    // Otherwise, keep existing "component match" highlighting behaviour
                    else if (hasComponents || hasYearOnlyMatch) {
                        highlightField(field);
                    }
                } else {
                    if (sourceText.includes(matchText))
                    {
                        // Highlight the date field in green and change the text color to white
                        highlightField(field);
                    }
                    else
                    {
                        multiHighlight(field, sourceText);
                    }
                }
            });

            // Also handle dates that Stash renders inside scene metadata headers.
            highlightSceneMetadataDates(searchItem, sourceText);

            // Get the entities, loop through and add verified icon when matched.
            // An entity can be verified either from filename/query OR from the local
            // "Matched/Совпавший" optional field rendered in the same row.
            let entityFields = searchItem.querySelectorAll('.entity-name');
            entityFields.forEach(obfield => {
                const entityValue = getEntityFieldValue(obfield);
                if (!entityValue) return;

                const matchLabel = getEntityMatchLabel(obfield);
                const matchedBySource = isTextMatchedBySource(entityValue, sourceText);
                const matchedLocally = isEntityMatchedLocally(obfield, entityValue);

                if (matchedBySource || matchedLocally) {
                    highlightVerifiedMatch(obfield);
                    addVerifiedIcon(
                        obfield,
                        matchedBySource
                            ? `${matchLabel} found in filename`
                            : `${matchLabel} matches local Stash item`
                    );
                }
            });

            // If several scraper result tabs are present, open the one with the strongest match score.
            activateBestSearchResult(searchItem, sourceText);
        });
    }

    // Run all highlight behaviours together
    function runAllHighlights() {
        highlightMatches();
        highlightFingerprints();
    }

    // MutationObserver to watch for DOM changes and trigger the highlight functions
    const observer = new MutationObserver(runAllHighlights);
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial execution of the highlight functions when the page is loaded
    window.addEventListener('load', runAllHighlights);
})();
