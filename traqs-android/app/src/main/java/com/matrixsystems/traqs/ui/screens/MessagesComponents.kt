package com.matrixsystems.traqs.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.matrixsystems.traqs.models.ChatGroup
import com.matrixsystems.traqs.models.Person
import com.matrixsystems.traqs.ui.theme.TIcons
import com.matrixsystems.traqs.ui.theme.TInset
import com.matrixsystems.traqs.ui.theme.TRadius
import com.matrixsystems.traqs.ui.theme.TTrack
import com.matrixsystems.traqs.ui.theme.TTypo
import com.matrixsystems.traqs.ui.theme.GradientCTA
import com.matrixsystems.traqs.ui.theme.frostedPill
import com.matrixsystems.traqs.ui.theme.glassControl
import com.matrixsystems.traqs.ui.theme.glassPanel
import com.matrixsystems.traqs.ui.theme.pageGroundTop
import com.matrixsystems.traqs.ui.theme.parseColor
import com.matrixsystems.traqs.ui.theme.traQSColors
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// ============================================================================
// Chat primitives - the Android half of the iOS messaging language.
//
// Ported from `TRAQS Scheduling/Views/MessagesView.swift` so the thread header,
// the members popover and the add/edit-people popups read the same on both
// platforms. Everything here is drawn with the app's own design system
// (Glass.kt / Tokens.kt / Typography.kt / TIcons) rather than hand-rolled
// surfaces, so the frosted-glass toggle and the accent reach it for free.
//
// The one deliberate departure is the system's standing one: Android has no
// backdrop blur, so where iOS masks a `.ultraThinMaterial` plate this paints a
// gradient of the page colour. The fade does the work the blur does - dissolving
// an edge instead of ending it on a hard line.
// ============================================================================

/** Two-letter initials, the same rule iOS's `Initials.from` uses. */
fun initialsFrom(name: String): String =
    name.trim().split(" ").filter { it.isNotBlank() }.take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")

/** A person's own colour, falling back to the accent. */
@Composable
fun personBrush(hex: String?): Brush {
    val c = traQSColors
    val color = hex?.let { runCatching { parseColor(it) }.getOrNull() } ?: c.accent
    return SolidColor(color)
}

/**
 * Circular initials avatar. `ring` draws the surface-coloured outline that lets
 * overlapping avatars read as separate faces.
 */
@Composable
fun TAvatar(
    initials: String,
    size: Dp,
    fill: Brush? = null,
    ring: Color? = null,
    modifier: Modifier = Modifier
) {
    val c = traQSColors
    val paint = fill ?: Brush.horizontalGradient(c.brandGradient)
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(paint)
            .then(if (ring != null) Modifier.border(2.dp, ring, CircleShape) else Modifier),
        contentAlignment = Alignment.Center
    ) {
        Text(
            initials.ifBlank { "?" },
            // Scales with the circle so a 28dp and a 52dp avatar read as the
            // same mark at different sizes rather than as two different ones.
            style = TTypo.bodyBold((size.value * 0.34f).sp),
            color = Color.White,
            maxLines = 1
        )
    }
}

/**
 * Up to `maxShown` overlapping avatars; anyone beyond that becomes a "+N" tile.
 *
 * The overlap scales with the avatar size - a fixed overlap that looks right on
 * a 26dp avatar leaves a 34dp one strung out, which is how the iOS inbox and
 * thread header ended up with visibly different clusters.
 */
@Composable
fun ParticipantStack(
    people: List<Person>,
    avatarSize: Dp = 28.dp,
    maxShown: Int = 3,
    overlap: Dp? = null,
    modifier: Modifier = Modifier
) {
    val c = traQSColors
    val tuck = overlap ?: (avatarSize * 0.6f)
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(-tuck),
        verticalAlignment = Alignment.CenterVertically
    ) {
        people.take(maxShown).forEach { p ->
            TAvatar(
                initials = initialsFrom(p.name),
                size = avatarSize,
                fill = personBrush(p.color),
                ring = c.surface
            )
        }
        if (people.size > maxShown) {
            Box(
                modifier = Modifier
                    .size(avatarSize)
                    .clip(CircleShape)
                    .background(c.surface)
                    .border(2.dp, c.surface, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "+${people.size - maxShown}",
                    style = TTypo.xsBold((avatarSize.value * 0.32f).sp),
                    color = c.text
                )
            }
        }
    }
}

// MARK: - Thread top bar (back - title - identity avatars)

/** The bar's own height (18 + 42 + 12), before the status bar and the fade tail. */
val THREAD_BAR_HEIGHT: Dp = 72.dp

/** The tail that dissolves the header plate into the page. */
val THREAD_HEADER_FADE: Dp = 36.dp

/**
 * The conversation header: back button, then the identity - a single avatar for
 * a DM or an overlapping stack for a group - with the title sitting just to its
 * left. Tapping the identity opens the members popover.
 */
@Composable
fun ThreadTopBar(
    title: String,
    isDM: Boolean,
    /** Used only to pick the OTHER person for a DM avatar. */
    myId: Int?,
    participants: List<Person>,
    onBack: () -> Unit,
    onTapIdentity: (() -> Unit)?
) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(THREAD_BAR_HEIGHT)
            .padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Back - the same glass control every header button in the app uses, so
        // it reads as one of them rather than as a one-off for this screen.
        Box(
            modifier = Modifier
                .size(42.dp)
                .glassControl()
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center
        ) {
            Icon(TIcons.ChevronLeft, "Back", tint = c.text, modifier = Modifier.size(20.dp))
        }

        Row(
            modifier = Modifier
                .weight(1f)
                .then(if (onTapIdentity != null) Modifier.clickable { onTapIdentity() } else Modifier),
            verticalAlignment = Alignment.CenterVertically,
            // Packed to the END, which is what puts the identity against the
            // right gutter the way iOS does.
            //
            // This was a `Spacer(weight 1f)` ahead of a `Text(weight 1f, fill =
            // false)`. Two weighted children SPLIT the free space evenly, so the
            // spacer only ever pushed the title half way, and the half the short
            // title didn't use was left stranded as a gap AFTER the avatar. The
            // name ended up floating near the middle of the bar.
            horizontalArrangement = Arrangement.spacedBy(11.dp, Alignment.End)
        ) {
            Text(
                title,
                // Matches the iOS header's tracking(-1.3) at 20pt.
                style = TTypo.h3(20.sp),
                letterSpacing = (-1.3).sp,
                color = c.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            // Identity on the RIGHT, name just to its left: one large avatar for
            // a DM, an overlapping stack for a group / job / panel / op.
            when {
                isDM -> TAvatar(
                    initials = initialsFrom(title),
                    size = 42.dp,
                    fill = participants.firstOrNull { it.id != myId }?.let { personBrush(it.color) }
                )
                participants.isNotEmpty() ->
                    ParticipantStack(people = participants, avatarSize = 34.dp, maxShown = 3)
                else -> TAvatar(initials = "#", size = 42.dp)
            }
        }
    }
}

/**
 * The header plate: the bar over a fill that dissolves into the page along its
 * bottom edge, so messages scrolling up run out under it instead of ending on a
 * hard line. iOS masks blurred glass; Android has no backdrop blur, so the
 * gradient IS the effect.
 *
 * The solid region is opaque on purpose. A translucent plate let the message
 * text scrolling underneath stay legible right behind the back button and the
 * title, which reads as a rendering fault rather than as glass - iOS can afford
 * a light plate only because its blur destroys the text it lets through.
 */
@Composable
fun ThreadHeaderPlate(
    title: String,
    isDM: Boolean,
    myId: Int?,
    participants: List<Person>,
    onBack: () -> Unit,
    onTapIdentity: (() -> Unit)?
) {
    val c = traQSColors
    // The page's OWN ground colour at the top of the screen — not `c.bg`. They
    // are near neighbours but not the same, and painting `c.bg` here left a
    // visibly flatter, greyer slab sitting on the washed page. This is the same
    // trick `NavBarScrim` plays at the other edge, flipped: opaque ground where
    // the chrome is, fading to nothing below it.
    val ground = pageGroundTop()
    Box(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.matchParentSize()) {
            Box(Modifier.weight(1f).fillMaxWidth().background(ground))
            Box(
                Modifier
                    .height(THREAD_HEADER_FADE)
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            0.00f to ground,
                            0.55f to ground.copy(alpha = 0.72f),
                            1.00f to ground.copy(alpha = 0f),
                        )
                    )
            )
        }
        Column(Modifier.fillMaxWidth()) {
            Spacer(Modifier.statusBarsPadding())
            ThreadTopBar(title, isDM, myId, participants, onBack, onTapIdentity)
            Spacer(Modifier.height(THREAD_HEADER_FADE))
        }
    }
}

// MARK: - Members popover (the header's dropdown)

/** A person in the header people popover - avatar + name in a glass capsule. */
@Composable
private fun PersonPill(person: Person) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .frostedPill()
            .padding(start = 6.dp, end = 16.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        TAvatar(initials = initialsFrom(person.name), size = 24.dp, fill = personBrush(person.color))
        Text(person.name, style = TTypo.smBold(14.sp), color = c.text, maxLines = 1)
    }
}

/**
 * The action pill below the roster - gradient, to stand out. A group thread
 * opens Edit Group (rename + add/remove), so the pill can't just say "Add
 * person" there: it would undersell what the popup does.
 */
@Composable
private fun AddPersonPill(isGroup: Boolean, onClick: () -> Unit) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(Brush.horizontalGradient(c.brandGradient), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            if (isGroup) TIcons.Edit else TIcons.UserPlus,
            null, tint = c.onGradient, modifier = Modifier.size(15.dp)
        )
        Text(
            if (isGroup) "Edit group" else "Add person",
            style = TTypo.smBold(14.sp), color = c.onGradient
        )
    }
}

/**
 * FAB-style popout from the thread header: the thread's people slide out as
 * pills from the trailing edge, one by one, with an "Add person" / "Edit group"
 * pill below. A fade sits behind them (iOS blurs; see the file header).
 */
@Composable
fun ThreadMembersPopover(
    visible: Boolean,
    participants: List<Person>,
    canAddPeople: Boolean,
    isGroup: Boolean,
    topInset: Dp,
    onDismiss: () -> Unit,
    onAddPeople: () -> Unit
) {
    val c = traQSColors
    Box(Modifier.fillMaxSize()) {
        // Tap anywhere to dismiss.
        if (visible) {
            Box(
                Modifier
                    .matchParentSize()
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onDismiss
                    )
            )
        }
        // Scrim behind the pills only - as tall as the list plus a soft tail, so
        // the conversation below it stays visible.
        val rows = participants.size + if (canAddPeople) 1 else 0
        val scrimHeight = topInset + (rows * 46).dp + 60.dp
        AnimatedVisibility(
            visible = visible,
            enter = fadeIn(tween(280)),
            exit = fadeOut(tween(280)),
            modifier = Modifier.align(Alignment.TopCenter)
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(scrimHeight)
                    .background(
                        Brush.verticalGradient(
                            0f to c.bg.copy(alpha = 0.92f),
                            0.66f to c.bg.copy(alpha = 0.92f),
                            1f to c.bg.copy(alpha = 0f)
                        )
                    )
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = topInset + 8.dp)
                .padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            participants.forEachIndexed { idx, p ->
                StaggeredPill(visible = visible, index = idx) { PersonPill(p) }
            }
            if (canAddPeople) {
                StaggeredPill(visible = visible, index = participants.size) {
                    AddPersonPill(isGroup = isGroup, onClick = onAddPeople)
                }
            }
        }
    }
}

/**
 * One pill of the popover: slides in from the trailing edge, staggered by its
 * position so the roster reveals top-down rather than all at once.
 */
@Composable
private fun StaggeredPill(visible: Boolean, index: Int, content: @Composable () -> Unit) {
    val delay = index * 50
    AnimatedVisibility(
        visible = visible,
        enter = slideInHorizontally(
            animationSpec = spring(dampingRatio = 0.74f, stiffness = Spring.StiffnessMediumLow),
            initialOffsetX = { it }
        ) + fadeIn(tween(220, delayMillis = delay, easing = LinearEasing)),
        exit = slideOutHorizontally(targetOffsetX = { it }) + fadeOut(tween(140))
    ) { content() }
}

// MARK: - Member picker grid

/**
 * The 3-up grid of square person cards shared by Add People and Edit Group, so
 * the two can't drift apart. Three per row keeps the initials readable and a
 * full first name visible while a whole roster still scans in a few rows.
 */
@Composable
fun MemberPickerGrid(
    people: List<Person>,
    selectedIds: Set<Int>,
    onToggle: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val c = traQSColors
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Keyed by POSITION as well as id, and that is load-bearing: the API's
        // person ids are mixed string/number, and `SafeIntDeserializer` turns
        // every non-numeric one into 0 — so a roster with two such people handed
        // this grid the same key twice and Compose threw
        // `Key "0" was already used`, taking the whole app down the moment the
        // picker opened. (Those people still collide for SELECTION, which is the
        // id decoding to fix, not this grid.)
        items(people.size, key = { idx -> "${people[idx].id}#$idx" }) { idx ->
            val person = people[idx]
            val selected = selectedIds.contains(person.id)
            Column(
                modifier = Modifier
                    .clip(RoundedCornerShape(TRadius.sm))
                    .background(
                        if (selected) c.accent.copy(alpha = 0.12f) else Color.Transparent,
                        RoundedCornerShape(TRadius.sm)
                    )
                    .border(
                        if (selected) 2.dp else 1.dp,
                        if (selected) c.accent else c.border,
                        RoundedCornerShape(TRadius.sm)
                    )
                    .clickable { onToggle(person.id) }
                    .padding(vertical = 12.dp, horizontal = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(contentAlignment = Alignment.BottomEnd) {
                    TAvatar(
                        initials = initialsFrom(person.name),
                        size = 46.dp,
                        fill = personBrush(person.color)
                    )
                    if (selected) {
                        Icon(
                            TIcons.CheckCircle, null, tint = c.accent,
                            modifier = Modifier
                                .offset(x = 3.dp, y = 3.dp)
                                .size(16.dp)
                                .clip(CircleShape)
                                .background(c.surface)
                        )
                    }
                }
                // First name only - a full name wraps at this width and leaves
                // the cards uneven heights.
                Text(
                    person.name.split(" ").firstOrNull() ?: person.name,
                    style = TTypo.xsBold(12.sp),
                    color = if (selected) c.accent else c.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

// MARK: - Popup shell

/**
 * The card every chat popup sits in: a scrim with a glass panel centred on it
 * and a cancel X inside its top-left corner - the Android shape of iOS's
 * `ModalScrim` + `glassPanel()` pair.
 */
@Composable
private fun ChatPopupCard(
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    val c = traQSColors
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.45f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = onDismiss
                ),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .padding(horizontal = 24.dp, vertical = 40.dp)
                    .widthIn(max = 380.dp)
                    .glassPanel(TRadius.lg)
                    // Swallow taps so the scrim's dismiss doesn't fire through
                    // the card.
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {}
                    )
            ) {
                Column(
                    modifier = Modifier.padding(
                        start = TInset.lg, end = TInset.lg, top = 46.dp, bottom = TInset.lg
                    ),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                    content = content
                )
                // Cancel, anchored INSIDE the card's top-left.
                Box(
                    modifier = Modifier
                        .padding(TInset.lg)
                        .size(36.dp)
                        .glassControl()
                        .clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(TIcons.Close, "Close", tint = c.text, modifier = Modifier.size(14.dp))
                }
            }
        }
    }
}

/** Search capsule shared by the popups. */
@Composable
private fun SearchPill(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    val c = traQSColors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .glassControl(CircleShape)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(TIcons.Search, null, tint = c.muted, modifier = Modifier.size(15.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, style = TTypo.sm(14.sp), color = c.muted)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = LocalTextStyle.current.merge(TTypo.sm(14.sp)).copy(color = c.text),
                cursorBrush = SolidColor(c.accent),
                modifier = Modifier.fillMaxWidth()
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                TIcons.Close, "Clear", tint = c.muted,
                modifier = Modifier.size(15.dp).clickable { onValueChange("") }
            )
        }
    }
}

// MARK: - Add People popup

/**
 * Presented from the header popover's "Add person" pill on a DM. Lists every
 * worker not already in the thread, with search and multi-select; the CTA hands
 * the picked ids back to the caller.
 */
@Composable
fun AddPeoplePopup(
    people: List<Person>,
    excludedIds: Set<Int>,
    onDismiss: () -> Unit,
    onAdd: (List<Int>) -> Unit
) {
    val c = traQSColors
    var search by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<Int>()) }
    val candidates = remember(people, excludedIds, search) {
        people
            .filter { it.id !in excludedIds }
            .filter {
                search.isBlank() ||
                    it.name.contains(search, true) ||
                    it.role.contains(search, true)
            }
            .sortedBy { it.name }
    }

    ChatPopupCard(onDismiss = onDismiss) {
        Text("Add People", style = TTypo.h3(20.sp), color = c.text)
        SearchPill(search, { search = it }, "Search workers")
        if (candidates.isEmpty()) {
            Text(
                if (search.isBlank()) "No one left to add." else "No matches.",
                style = TTypo.sm(13.sp), color = c.muted,
                modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp)
            )
        } else {
            MemberPickerGrid(
                people = candidates,
                selectedIds = selected,
                onToggle = { id -> selected = if (id in selected) selected - id else selected + id },
                modifier = Modifier.heightIn(max = 320.dp)
            )
        }
        GradientCTA(
            onClick = {
                onAdd(selected.toList())
                onDismiss()
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = selected.isNotEmpty()
        ) {
            Icon(TIcons.Plus, null, tint = c.onGradient, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(7.dp))
            Text(
                if (selected.isEmpty()) "Add" else "Add (${selected.size})",
                style = TTypo.smBold(15.sp), color = c.onGradient
            )
        }
    }
}

// MARK: - Edit Group popup

/**
 * Parity with iOS's Edit Group: rename the group AND add or remove members.
 * The name is optional - clearing it goes back to naming the group after its
 * members, which is a supported edit and not a no-op.
 */
@Composable
fun EditGroupPopup(
    group: ChatGroup,
    people: List<Person>,
    myId: Int?,
    onDismiss: () -> Unit,
    onSave: (String, List<Int>) -> Unit
) {
    val c = traQSColors
    var name by remember { mutableStateOf(group.name) }
    var selected by remember { mutableStateOf(group.memberIds.toSet()) }
    // Never lists the viewer: the save path keeps them a member regardless, so
    // selecting yourself did nothing.
    val others = remember(people, myId) { people.filter { it.id != myId }.sortedBy { it.name } }
    val placeholder = ChatGroup.memberNamesLine(selected.toList(), people, myId)

    ChatPopupCard(onDismiss = onDismiss) {
        Text("Edit Group", style = TTypo.h3(20.sp), color = c.text)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "GROUP NAME", style = TTypo.xxs(10.sp),
                    color = c.muted, letterSpacing = TTrack.section
                )
                Text(
                    "OPTIONAL", style = TTypo.xxs(10.sp),
                    color = c.accent, letterSpacing = TTrack.section
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .glassControl(RoundedCornerShape(TRadius.sm))
                    .padding(horizontal = 14.dp, vertical = 12.dp)
            ) {
                if (name.isEmpty()) {
                    Text(placeholder, style = TTypo.sm(14.sp), color = c.muted, maxLines = 1)
                }
                BasicTextField(
                    value = name,
                    onValueChange = { name = it },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.merge(TTypo.sm(14.sp)).copy(color = c.text),
                    cursorBrush = SolidColor(c.accent),
                    modifier = Modifier.fillMaxWidth()
                )
            }
            Text(
                "Clear it to go back to naming the group after its members.",
                style = TTypo.xs(11.sp), color = c.muted
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "MEMBERS", style = TTypo.xxs(10.sp),
                color = c.muted, letterSpacing = TTrack.section
            )
            MemberPickerGrid(
                people = others,
                selectedIds = selected,
                onToggle = { id -> selected = if (id in selected) selected - id else selected + id },
                modifier = Modifier.heightIn(max = 300.dp)
            )
        }
        GradientCTA(
            onClick = {
                // The viewer stays a member whatever the grid says.
                val members = if (myId != null) (listOf(myId) + selected).distinct() else selected.toList()
                onSave(name.trim(), members)
                onDismiss()
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = selected.isNotEmpty()
        ) {
            Text("Save Changes", style = TTypo.smBold(15.sp), color = c.onGradient)
        }
    }
}

// MARK: - Timestamps
//
// Ports of the `String` extensions at the bottom of iOS MessagesView.swift, so
// both apps label a conversation the same way.

private fun parseIso(ts: String): Date? {
    val patterns = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX"
    )
    for (p in patterns) {
        val d = runCatching {
            val f = SimpleDateFormat(p, Locale.US)
            if (p.endsWith("'Z'")) f.timeZone = TimeZone.getTimeZone("UTC")
            f.parse(ts)
        }.getOrNull()
        if (d != null) return d
    }
    return null
}

private fun isSameDay(a: Date, b: Date): Boolean {
    val ca = Calendar.getInstance().apply { time = a }
    val cb = Calendar.getInstance().apply { time = b }
    return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) &&
        ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
}

private fun daysAgo(n: Int): Date =
    Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -n) }.time

private fun fmt(pattern: String, d: Date): String = SimpleDateFormat(pattern, Locale.US).format(d)

private fun inCurrentYear(d: Date): Boolean =
    Calendar.getInstance().apply { time = d }.get(Calendar.YEAR) ==
        Calendar.getInstance().get(Calendar.YEAR)

/**
 * Header for an in-thread message cluster, marking when it started.
 * Today -> "Today at 9:30PM" - yesterday -> "Yesterday at 9:30PM" -
 * earlier this year -> "June 30 at 2:15PM" - older -> "June 30, 2025 at 2:15PM".
 */
fun sectionStamp(ts: String): String {
    val d = parseIso(ts) ?: return ts
    val t = fmt("h:mma", d)
    if (isSameDay(d, Date())) return "Today at $t"
    if (isSameDay(d, daysAgo(1))) return "Yesterday at $t"
    return "${fmt(if (inCurrentYear(d)) "MMMM d" else "MMMM d, yyyy", d)} at $t"
}

/**
 * Compact stamp on the tap-to-reveal message timestamp.
 * Today -> "2:34 PM" - Yesterday -> "Yesterday" - earlier -> "May 24".
 */
fun messageStamp(ts: String): String {
    val d = parseIso(ts) ?: return ts
    if (isSameDay(d, Date())) return fmt("h:mm a", d)
    if (isSameDay(d, daysAgo(1))) return "Yesterday"
    return fmt(if (inCurrentYear(d)) "MMM d" else "MMM d, yyyy", d)
}

/**
 * Date stamp for the inbox thread list. Today -> "Today at 9:30PM";
 * any earlier day -> full month + day, e.g. "June 30".
 */
fun threadDateStamp(ts: String): String {
    val d = parseIso(ts) ?: return ts
    if (isSameDay(d, Date())) return "Today at ${fmt("h:mma", d)}"
    return fmt(if (inCurrentYear(d)) "MMMM d" else "MMMM d, yyyy", d)
}
