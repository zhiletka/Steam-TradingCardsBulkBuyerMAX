// ==UserScript==
// @name            Steam-TradingCardsBulkBuyerMAX
// @version         1.03
// @description     A free userscript to purchase remaining cards needed for a maximum level badge in bulk
// @author          Zhiletka
// @match           *://steamcommunity.com/*/gamecards/*
// @require         https://ajax.googleapis.com/ajax/libs/jquery/2.0.3/jquery.min.js
// @copyright       2018 Zhiletka. Contains parts of the Steam Trading Cards Bulk Buyer script © 2013 - 2015 Dr. McKay
// @grant           none
// ==/UserScript==

$.ajaxSetup({
    cache: false, // ???
    xhrFields: {
        withCredentials: true
    }
});

var g_Now = Date.now();
var g_StatusSeparator = " - ";
var g_SessionID;

// Current currency (numerical identifier used by Steam)
var g_Currency = 1;

// Initialize default currency information
var g_CurrencyInfo = {
    symbol_prefix: "",
    symbol_suffix: "",
    separator: "."
};

// Default history analyze range
var g_HistoryRangeDays = 14;

// Initialize default badge settings
var g_BadgeLevel = 0;
var g_BadgeMaxLevel = 5;

$(document).ready(function() {
    // Ensure that the page is loaded in HTTPS (Issue #19)
    if (document.location.protocol != 'https:') {
        let badgePageUrl = window.location.href;
        window.location.href = badgePageUrl.replace('http://', 'https://');
    }
});

if ($('.badge_card_set_card').length && $('.badge_info').length) {
    // Get current badge level
    if ($('.badge_info_unlocked').length) {
        g_BadgeLevel = parseInt($('meta[property="og:description"]').attr('content').match(/\d+/), 10);
    }

    // Set max level to 1 for a Foil badge
    if (document.documentURI.includes('border=1')) {
        g_BadgeMaxLevel = 1;
    }

    $('.badge_detail_tasks:first').append('<div style="margin: 10px"><div id="bb_panel" style="visibility: hidden; margin-top: 5px"/></div>');

    updatePrices();

    // We have to do this visibility/display thing in order for offsetWidth to work
    $('#bb_panel').css({display: 'none', visibility: 'visible'}).show('blind');
}

function updatePrices() {
    $('#bb_panel').html('');

    Array.prototype.slice.call($('.badge_card_set_card')).forEach(function(card) {
        card = $(card);

        var cardText = card.find('.badge_card_set_text')[0].textContent;
        var quantity = cardText.match(/\((\d+)\)\r?\n|\r/);
        if (quantity) {
            quantity = parseInt(quantity[1], 10);
            cardText = cardText.substring(cardText.indexOf(')') + 1);
        } else {
            quantity = 0;
        }
        quantity = (g_BadgeMaxLevel - g_BadgeLevel) - quantity;
        if (quantity < 1) {
            return;
        }

        // Some cards have leading space in their names, for example:
        // https://steamcommunity.com/market/listings/753/431260-%20The%20ghost%20is%20racing%20to%20rescue
        // Therefore we can't just trim all whitespace characters, spaces must be ignored
        var cardName = cardText.replace(/\t|\r?\n|\r/g, '');

        if ($('#bb_panel').html().length == 0) {
            $('#bb_panel').append('<div class="badge_title_rule"/><div class="badge_title">Steam Trading Cards Bulk Buyer MAX</div><br/>');
        }

        var row = $('<div class="bb_cardrow" style="padding-bottom: 3px; opacity: 0.4"><label><input class="bb_cardcheckbox" type="checkbox" style="margin: 0; vertical-align: bottom; position: relative; top: -1px" checked onchange="bb_cardcheckbox_change()"/><script>function bb_cardcheckbox_change() { $("#bb_changemode").change(); }</script><span class="bb_cardname" style="padding-right: 10px; text-align: right; display: inline-block; font-weight: bold">' + cardName + ' (' + quantity + ')</span></label><span class="bb_cardprice" data-name="' + cardName.replace(/"/g, '&quot;') + '"/></div>');
        $('#bb_panel').append(row);

        row.data('quantity', quantity);

        setCardStatus(row, 'Loading...');

        var appID = document.documentURI.match(/gamecards\/(\d+)/);
        var cardPageUrl = 'https://steamcommunity.com/market/listings/753/' + appID[1] + '-' + encodeURIComponent(cardName);

        // Some cards have "(Trading Card)" suffix in their urls
        // We can't detect card url when it bought and no market button is shown, so the solution is to try original url first, and then the alternative one
        cardPageAjaxRequest(g_BadgeMaxLevel > 1 ? [cardPageUrl + ' (Trading Card)', cardPageUrl] : [cardPageUrl + ' (Foil Trading Card)', cardPageUrl + ' (Foil)']);

        function cardPageAjaxRequest(urls) {
            // Assuming that all possible card pages returned null marketID/sessionID/hashName
            if (urls.length == 0) {
                setCardStatusError(row, 'There are no listings for this item');
                return;
            }

            $.get(urls.pop()).done(function(html) {
                var marketID = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\);/);
                var sessionID = html.match(/g_sessionID = "(.+)";/);
                var countryCode = html.match(/g_strCountryCode = "([a-zA-Z0-9]+)";/);
                var currency = html.match(/"wallet_currency":(\d+)/);
                var hashName = html.match(/"market_hash_name":"((?:[^"\\]|\\.)*)"/);
                var oldOrderID = html.match(/CancelMarketBuyOrder\(\D*(\d+)\D*\)/);

                if (!currency || !countryCode) {
                    setCardStatusError(row, 'Not logged in');
                    return;
                }

                if (!marketID || !sessionID || !hashName) {
                    return cardPageAjaxRequest(urls);
                }

                g_Currency = currency[1];
                g_SessionID = sessionID[1];

                // Unescape quotes and unicode characters in hash names like "461280-\"Cool Kids\" Hangout" and "554640-\u901a\u7f09\u677f"
                hashName[1] = decodeURIComponent(JSON.parse('"' + hashName[1] + '"'));

                $.get('/market/itemordershistogram', {"country": countryCode[1], language: 'english', "currency": g_Currency, "item_nameid": marketID[1]}).always(function(histogram) {
                    if (!histogram || !histogram.success) {
                        setCardStatusError(row, 'Failed to get item orders histogram');
                        return;
                    }

                    // Get the currency symbol
                    if (histogram.price_prefix) {
                        g_CurrencyInfo.symbol_prefix = histogram.price_prefix;
                    } else {
                        g_CurrencyInfo.symbol_suffix = histogram.price_suffix;
                    }

                    // Get the separator of the price
                    var strToMatch;
                    if (histogram.sell_order_graph.length) {
                        strToMatch = histogram.sell_order_graph[0][2];
                    } else if (histogram.buy_order_graph.length) {
                        strToMatch = histogram.buy_order_graph[0][2];
                    }
                    if (strToMatch) {
                        let regexString = g_CurrencyInfo.symbol_prefix.replace("$", "\\\$") + '\\s?\\S+(\\D+)\\d{2}\\s?' + g_CurrencyInfo.symbol_suffix.replace("$", "\\\$");
                        g_CurrencyInfo.separator = new RegExp(regexString, "g").exec(strToMatch)[1];
                    }

                    // When card has only ONE buy or sell order, the corresponding graph is empty
                    // Therefore we parse some other page elements to add a sole record like [0.66, 66, "66 buy orders at $0.66 or higher"]
                    [[histogram.buy_order_graph, histogram.highest_buy_order, histogram.buy_order_summary], [histogram.sell_order_graph, histogram.lowest_sell_order, histogram.sell_order_summary]].forEach(function(array) {
                        if (!array[0].length && array[1]) {
                            let s = new DOMParser().parseFromString(array[2], 'text/html').documentElement.textContent;
                            let p = s.match(/(\d+)\D*([\d.]+)/);
                            array[0].push([Number(p[2]), Number(p[1]), s]);
                        }
                    });

                    $.get('/market/pricehistory', {"appid": 753, "market_hash_name": hashName[1]}).always(function(history) {
                        // Preprocess the history
                        if (history && history.success && history.prices) {
                            for (let i = 0; i < history.prices.length; i++) {
                                history.prices[i][0] = Date.parse(history.prices[i][0]);   // Convert date to Unix timestamp
                                history.prices[i][2] = parseInt(history.prices[i][2], 10); // Convert sales count from string to integer
                                history.prices[i][1] *= 100;                               // Multiply prices so they're in pennies
                            }
                        }

                        row.data('hashname', hashName[1]);
                        row.data('histogram', histogram);
                        row.data('history', history);

                        var price = getOptimumPrice(histogram, history, quantity);
                        row.data('price_total', price[0] * quantity);

                        if (oldOrderID) {
                            let oldOrderData = html.match(/market_listing_inline_buyorder_qty\D+(\d+)\D+([\d.]+)/);
                            row.data('old_orderid', oldOrderID[1]);
                            row.data('old_orderdata', ' <span style="opacity: 0.5"><strike>' + oldOrderData[1] + ' x ' + priceToString(Number(oldOrderData[2])) + ' order</strike></span>');
                        }

                        setCardStatus(row, priceToString(price[0] * quantity - price[1], true) + g_StatusSeparator + price[2] + (row.data('old_orderdata') ? row.data('old_orderdata') : ''));
                        row.css('opacity', 1);

                        row.addClass('ready');

                        if ($('.bb_cardrow:not(.ready)').length === 0) {
                            let w = $('.bb_cardprice:first').offset().left - $('.bb_cardrow:first').offset().left - 10;
                            $('#bb_panel').append('<br/><b><span style="display: inline-block; width: ' + w + 'px; padding-right: 10px; text-align: right">TOTAL</span><span id="bb_totalprice"/></b><br/><div id="bb_controls"><br/><label><input type="checkbox" id="bb_changemode" style="margin-left: 0; margin-right: 10px; vertical-align: middle; position: relative; top: -1px"/>Buy immediately</label><span id="bb_historyrange"><span style="padding-left: 30px; padding-right: 10px">History analyze range</span><input type="range" id="bb_rangeslider" style="vertical-align: middle; width: 30%"/><span id="bb_slidervalue" style="padding-left: 10px"/></span><br/><br/><button type="button" id="bb_placeorders" class="btn_green_white_innerfade btn_medium_wide" style="padding: 10px 20px">PLACE ORDERS</button><br/></div>');

                            let t_oldest, t_latest;
                            for (let i = 0, cards = $('.bb_cardrow'); i < cards.length; i++) {
                                let prices = $(cards[i]).data('history').prices;
                                if (prices && prices.length) {
                                    t_oldest = Math.min(prices[0][0], t_oldest || Number.MAX_VALUE);
                                    t_latest = Math.max(prices[prices.length-1][0], t_latest || 0);
                                }
                            }

                            if (t_oldest && t_latest) {
                                t_oldest = Math.round((g_Now - t_oldest) / 86400000);
                                t_latest = Math.round((g_Now - t_latest) / 86400000);
                                g_HistoryRangeDays = Math.min(t_oldest, g_HistoryRangeDays);

                                $('#bb_slidervalue').text(g_HistoryRangeDays + ' days');
                                $('#bb_rangeslider').prop({min: t_latest, max: t_oldest, value: g_HistoryRangeDays});
                                $('#bb_rangeslider').on('input change', function() {
                                    g_HistoryRangeDays = $(this).val();
                                    $('#bb_slidervalue').text(g_HistoryRangeDays + ' days');
                                    $('#bb_changemode').change();
                                });
                            } else {
                                $('#bb_historyrange').css('display', 'none');
                            }

                            $('#bb_changemode').change(function() {
                                var total = 0;
                                for (let i = 0, cards = $('.bb_cardrow'); i < cards.length; i++) {
                                    let card = $(cards[i]);
                                    let quantity = card.data('quantity');
                                    let price = (this.checked ? getImmediatePrice : getOptimumPrice)(card.data('histogram'), card.data('history'), quantity);
                                    card.data('price_total', price[0] * quantity);
                                    setCardStatus(card, priceToString(price[0] * quantity - price[1], true) + g_StatusSeparator + price[2] + (card.data('old_orderdata') ? card.data('old_orderdata') : ''));
                                    if (card.find('.bb_cardcheckbox').is(':checked')) {
                                        total += price[0] * quantity - price[1];
                                        card.removeClass('skip');
                                        card.css('opacity', 1);
                                    } else {
                                        card.addClass('skip');
                                        card.css('opacity', 0.4);
                                    }
                                }

                                $('#bb_totalprice').text(priceToString(total, true));
                                $('#bb_historyrange').css('visibility', this.checked ? 'hidden' : 'visible');
                            });

                            $('#bb_changemode').change();

                            $('#bb_placeorders').click(function() {
                                $('.bb_cardcheckbox').prop('disabled', true);
                                $('#bb_controls').hide();
                                placeBuyOrder();
                            });
                        }
                    });
                });
            }).fail(function(jqXHR) {
                setCardStatusError(row, '(' + jqXHR.status + ') ' + jqXHR.statusText);
            });
        }
    });

    var elements = $('.bb_cardname');
    if (elements.length > 0) {
        let largestWidth = 0;
        for (let i = 1; i < elements.length; i++) {
            if (elements[i].offsetWidth > elements[largestWidth].offsetWidth) {
                largestWidth = i;
            }
        }
        $('.bb_cardname').css('width', elements[largestWidth].offsetWidth + 'px');
    }
}

function placeBuyOrder() {
    var card = $('.bb_cardrow:not(.buying,.canceling,.skip)')[0];
    if (!card) {
        return;
    }

    card = $(card);

    if (card.data('old_orderid')) {
        card.addClass('canceling');
        setCardStatus(card, 'Canceling active order...');

        cancelBuyOrder(card.data('old_orderid'), function(json) {
            card.removeData('old_orderid');
            card.removeClass('canceling');
            setTimeout(placeBuyOrder, 500);
        });
    } else {
        card.addClass('buying');
        setCardStatus(card, 'Placing buy order...');

        $.post('https://steamcommunity.com/market/createbuyorder/', {"sessionid": g_SessionID, "currency": g_Currency, "appid": 753, "market_hash_name": card.data('hashname'), "price_total": card.data('price_total'), "quantity": card.data('quantity')}).done(function(json) {
            setTimeout(placeBuyOrder, 500);

            if (json.success !== 1) {
                setCardStatusError(card, json.message);
                return;
            }

            card.data('buy_orderid', json.buy_orderid);
            card.data('checks', 0);
            card.data('checks_max', $('#bb_changemode').is(':checked') ? 10 : 2);

            setCardStatus(card, 'Waiting...');
            checkOrderStatus(card);
        });
    }
}

function checkOrderStatus(card) {
    $.get('/market/getbuyorderstatus/', {"sessionid": g_SessionID, "buy_orderid": card.data('buy_orderid')}).always(function(json) {
        if (json && json.success === 1) {
            if (json.quantity_remaining == 0) {
                setCardStatusSuccess(card, 'Purchased');
                return;
            } else {
                card.data('checks', card.data('checks') + 1);
                if (card.data('checks') >= card.data('checks_max')) {
                    setCardStatusSuccess(card, 'Order placed');
                    return;
                }
            }
        }

        setTimeout(function() {
            checkOrderStatus(card);
        }, 500);
    });
}

function cancelBuyOrder(orderid, callback) {
    $.post('/market/cancelbuyorder/', {"sessionid": g_SessionID, "buy_orderid": orderid}).always(function(json) {
        if (json && json.success === 1) {
            callback(json);
        } else {
            setTimeout(function() {
                cancelBuyOrder(orderid, callback);
            }, 500);
        }
    });
}

function setCardStatus(card, status) {
/*
    var timer = card.data('timer');
    if (timer) {
        clearTimeout(timer);
        card.removeData('timer');
    }
*/
    var oldStatus = card.find('.bb_cardprice').html();
    var p = oldStatus.indexOf(g_StatusSeparator);
    card.find('.bb_cardprice').html(p >= 0 && status.indexOf(g_StatusSeparator) < 0 ? oldStatus.substring(0, p + g_StatusSeparator.length) + status : status);
/*
    if (status.match(/\.{3}$/)) {
        card.data('timer', setTimeout(function() { addDot(card); }, 500));
    }

    function addDot(card) {
        card.find('.bb_cardprice')[0].innerHTML += ".";
        card.data('timer', setTimeout(function() { addDot(card); }, 500));
    }
*/
}

function setCardStatusError(card, status) {
    setCardStatus(card, status);
    card.find('.bb_cardcheckbox').prop({checked: false, disabled: true});
    card.css({color: 'FireBrick', opacity: 0.8});
    card.removeClass();
}

function setCardStatusSuccess(card, status) {
    setCardStatus(card, status);
    card.css('color', 'YellowGreen');
}

function priceToString(price, cents) {
    if (cents) {
        price = parseInt(price, 10) / 100;
    }
    return g_CurrencyInfo.symbol_prefix + price.toFixed(2).replace(".", g_CurrencyInfo.separator) + g_CurrencyInfo.symbol_suffix;
}

function getOptimumPrice(histogram, history, quantity) {
    if (history && history.success && history.prices) {
        if (histogram && histogram.buy_order_graph.length) {
            for (let j = histogram.buy_order_graph.length - 1; j >= 0; j--)
            {
                let price = histogram.buy_order_graph[j][0] * 100;
                let cardsSold = histogram.buy_order_graph[j][1] + quantity;
                for (let i = history.prices.length - 1; i >= 0 && (g_Now - history.prices[i][0]) / 86400000 <= g_HistoryRangeDays; i--) {
                    if (history.prices[i][1] <= price && --cardsSold == 0) {
                        return [price, 0, 'Optimum history price'];
                    }
                }
            }
        } else {
            let price;
            for (let i = history.prices.length - 1; i >= 0 && (g_Now - history.prices[i][0]) / 86400000 <= g_HistoryRangeDays; i--) {
                price = Math.min(history.prices[i][1], price || Number.MAX_VALUE);
            }
            if (price) {
                return [price, 0, 'Lowest history price'];
            }
        }
    }

    if (histogram) {
        if (histogram.highest_buy_order) {
            return [parseInt(histogram.highest_buy_order, 10) + 1, 0, 'Highest buy order'];
        }
        if (histogram.lowest_sell_order) {
            return [parseInt(histogram.lowest_sell_order, 10), 0, 'Lowest sell order'];
        }
    }

    return [3, 0, 'No buy/sell orders to analyze'];
}

function getImmediatePrice(histogram, history, quantity) {
    if (!histogram || !histogram.sell_order_graph.length) {
        return getOptimumPrice(histogram, history, quantity);
    }

    var total = 0;
    var quantityLeft = quantity;
    var maxPrice = 0;

    for (let i = 0; i < histogram.sell_order_graph.length && quantityLeft > 0;) {
        maxPrice = histogram.sell_order_graph[i][0] * 100;
        let buyQuantity = Math.min(histogram.sell_order_graph[i][1], quantityLeft);
        total += maxPrice * buyQuantity;
        if ((quantityLeft -= buyQuantity) <= 0) {
            return [maxPrice, maxPrice * quantity - total, 'OK'];
        }
        if (buyQuantity == histogram.sell_order_graph[i][1]) {
            i++;
        }
    }

    return [maxPrice, maxPrice * quantity - total, 'Not enough ' + quantityLeft + ' sell orders'];
}
