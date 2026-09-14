package com.matrixsystems.traqs.ui.navigation

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.matrixsystems.traqs.ui.theme.TElevation
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.ambientFloat
import com.matrixsystems.traqs.ui.theme.flatHairline
import com.matrixsystems.traqs.ui.theme.traQSColors

// The TRAQS floating tab bar — a port of iOS TRAQSTabBar (Views/MainTabView).
//
// Icon-only pill in the app's frosted-glass language: a translucent preset-driven
// tint, an ambient float shadow, and ONE accent highlighter that slides between
// tabs. Order matches iOS exactly: Jobs · Time Clock · Home · Messages · Analytics.
//
// The bar gets its OWN tint rather than the card tint, because it is the one
// surface that has to hold five small glyphs legible against whatever page is
// drifting underneath it. Each preset pushes the bar AWAY from its page —
// near-solid white on White, near-black on Charcoal — so the icons read at full
// contrast either way.

// Glyphs come from TIcons — traced from the web app's sidebar, so the bar reads
// as the same product as the site. See TIcons for why these are not Material's.
enum class TTab(val label: String, val icon: ImageVector) {
    JOBS("Jobs", TIcons.Jobs),
    HOURS("Time Clock", TIcons.Clock),
    HOME("Home", TIcons.Home),
    CHAT("Messages", TIcons.Chat),
    STATS("Analytics", TIcons.Analytics),
}

// Display order of the bar, independent of declaration order. Home sits in the
// CENTRE — it is the landing tab, and the middle key is the one your thumb finds
// without looking.
val tabBarOrder: List<TTab> = listOf(TTab.JOBS, TTab.HOURS, TTab.HOME, TTab.CHAT, TTab.STATS)

// Fixed layout — keys are fixed-width, so the bar width is deterministic and a
// drag x maps to a tab without measuring anything.
private val keyW: Dp = 57.dp
private val keySpacing: Dp = 2.dp
private val hPad: Dp = 15.dp

// The highlighter is the tallest thing in the bar, so its height sets the inner
// height; vPad absorbs the difference to keep the pill's outer height fixed.
private val highlightW: Dp = 73.dp   // keyW + 16
private val highlightH: Dp = 54.dp
private val barHeight: Dp = 66.dp
private val vPad: Dp = (barHeight - highlightH) / 2

@Composable
fun TRAQSTabBar(
    selected: TTab,
    onSelect: (TTab) -> Unit,
    modifier: Modifier = Modifier,
    chatBadge: Int = 0,
) {
    val c = traQSColors
    val density = LocalDensity.current
    val shape = CircleShape

    // Finger x while actively dragging, in the bar's local space. Drives both the
    // highlighter and which icon reads as active, so a press-and-slide previews
    // each tab as you cross it.
    var dragX by remember { mutableStateOf<Float?>(null) }

    val contentWidth = keyW * tabBarOrder.size + keySpacing * (tabBarOrder.size - 1)
    val barWidth = hPad * 2 + contentWidth

    fun tabAtX(xPx: Float): TTab {
        val x = with(density) { xPx.toDp() }
        val step = keyW + keySpacing
        val idx = ((x - hPad + keySpacing / 2) / step).toInt()
        return tabBarOrder[idx.coerceIn(0, tabBarOrder.size - 1)]
    }

    fun restingCenter(tab: TTab): Dp {
        val i = tabBarOrder.indexOf(tab).coerceAtLeast(0)
        return keyW * i + keySpacing * i + keyW / 2
    }

    // The tab the highlighter currently sits on — the finger's tab while
    // dragging, else the selection. This is what drives which icon reads active,
    // so the preview leads the commit.
    val highlighted = dragX?.let { tabAtX(it) } ?: selected

    // Highlighter centre: the finger while dragging (clamped inside the row),
    // else the selected tab's resting centre.
    val targetCenter = dragX?.let {
        with(density) { it.toDp() - hPad }.coerceIn(keyW / 2, contentWidth - keyW / 2)
    } ?: restingCenter(selected)

    // A spring, not a timing curve: the light underdamping is what gives the
    // arrival its bounce. While dragging the animation is skipped so the pill
    // tracks the finger 1:1.
    val animatedCenter by animateDpAsState(
        targetValue = targetCenter,
        animationSpec = if (dragX == null) spring(dampingRatio = 0.62f, stiffness = 440f)
                        else spring(dampingRatio = 1f, stiffness = Spring.StiffnessHigh),
        label = "highlight"
    )

    Box(
        modifier = modifier
            .width(barWidth)
            .height(barHeight)
            .ambientFloat(shape)
            .clip(shape)
            // The bar's paint. Deliberately NOT the card tint — that sat too
            // close to the page for five small glyphs to hold their own.
            .background(c.navTint.copy(alpha = c.navTintOpacity), shape)
            // A hairline, not the specular rim: the lit bevel is for surfaces you
            // look AT. On permanent chrome it read as a bright wire tracing the
            // pill, and the ambient shadow already separates the bar from the page.
            .flatHairline(shape)
            .pointerInput(Unit) {
                detectTapGestures { offset -> onSelect(tabAtX(offset.x)) }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { offset -> dragX = offset.x },
                    onDragEnd = {
                        dragX?.let { onSelect(tabAtX(it)) }
                        dragX = null
                    },
                    onDragCancel = { dragX = null },
                ) { change, _ -> dragX = change.position.x }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        // The ONE accent highlighter, behind the icons. Painted here rather than
        // as an overlay so the icons ride ON it.
        Box(
            Modifier
                .padding(start = hPad)
                .offset(x = animatedCenter - highlightW / 2)
                .size(highlightW, highlightH)
                .clip(shape)
                .background(c.accent, shape)
        )

        Row(
            modifier = Modifier.padding(horizontal = hPad, vertical = vPad),
            horizontalArrangement = Arrangement.spacedBy(keySpacing),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tabBarOrder.forEach { tab ->
                TabBarIcon(
                    tab = tab,
                    isSelected = highlighted == tab,
                    badge = if (tab == TTab.CHAT) chatBadge else 0,
                )
            }
        }
    }
}

// Non-interactive icon cell — selection is driven by the bar's own gestures, so
// these must not swallow the touch.
@Composable
private fun TabBarIcon(tab: TTab, isSelected: Boolean, badge: Int) {
    val c = traQSColors
    Box(
        modifier = Modifier.width(keyW).height(highlightH),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = tab.icon,
            contentDescription = tab.label,
            // Readable on the accent fill when the highlighter is on this tab;
            // primary ink otherwise.
            tint = if (isSelected) c.onAccent else c.text,
            modifier = Modifier.size(21.dp),
        )
        if (badge > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-6).dp, y = 4.dp)
                    .defaultMinSize(minWidth = 16.dp, minHeight = 16.dp)
                    .clip(CircleShape)
                    .background(c.red, CircleShape)
                    .padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (badge > 99) "99+" else "$badge",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
        }
    }
}
