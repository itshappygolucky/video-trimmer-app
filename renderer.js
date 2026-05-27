let currentVideoPath = null;
let videoDuration = 0;
let startTime = 0;
let endTime = 0;
let losslessCutPoints = [];
let activeTrimHandle = null;
let folderVideos = [];
let playheadAnimationFrame = null;
let currentFolderPath = null;
let isScrubbingTimeline = false;
let currentVideo = null;
const settings = {
    appendCutTimes: true,
    rememberLastFolder: false,
    showDeleteOption: true,
    autoAdvance: false
};

const videoPlayer = document.getElementById('videoPlayer');
const selectVideoBtn = document.getElementById('selectVideoBtn');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevKeyframeBtn = document.getElementById('prevKeyframeBtn');
const nextKeyframeBtn = document.getElementById('nextKeyframeBtn');
const setStartBtn = document.getElementById('setStartBtn');
const setEndBtn = document.getElementById('setEndBtn');
const resetBtn = document.getElementById('resetBtn');
const trimBtn = document.getElementById('trimBtn');
const startTimeInput = document.getElementById('startTime');
const endTimeInput = document.getElementById('endTime');
const fileInfo = document.getElementById('fileInfo');
const statusDiv = document.getElementById('status');
const folderSummary = document.getElementById('folderSummary');
const librarySearch = document.getElementById('librarySearch');
const libraryPanel = document.getElementById('libraryPanel');
const videoGrid = document.getElementById('videoGrid');
const videoSortSelect = document.getElementById('videoSort');
const trimSlider = document.getElementById('trimSlider');
const keyframeMarkers = document.getElementById('keyframeMarkers');
const selectedRange = document.getElementById('selectedRange');
const playheadMarker = document.getElementById('playheadMarker');
const timelineTooltip = document.getElementById('timelineTooltip');
const startHandle = document.getElementById('startHandle');
const endHandle = document.getElementById('endHandle');
const sliderStartLabel = document.getElementById('sliderStartLabel');
const sliderEndLabel = document.getElementById('sliderEndLabel');
const APPEND_CUT_TIMES_SETTING = 'videoTrimmer.appendCutTimes';
const REMEMBER_LAST_FOLDER_SETTING = 'videoTrimmer.rememberLastFolder';
const SHOW_DELETE_OPTION_SETTING = 'videoTrimmer.showDeleteOption';
const AUTO_ADVANCE_SETTING = 'videoTrimmer.autoAdvance';
const LAST_FOLDER_SETTING = 'videoTrimmer.lastFolder';
const MIN_TRIM_SECONDS = 0.1;
const KEYFRAME_SEEK_EPSILON = 0.05;

// Helper function to format time
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(1);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDurationTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return 'Unknown duration';
    }

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join(':');
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return '';
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toFileUrl(filePath) {
    return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getTimePercent(time) {
    if (!videoDuration) {
        return 0;
    }

    return clamp((time / videoDuration) * 100, 0, 100);
}

function getSliderTime(event) {
    const rect = trimSlider.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);

    return percent * videoDuration;
}

function updatePlayPauseButton() {
    const isPaused = videoPlayer.paused;

    playPauseBtn.textContent = isPaused ? '▶' : '❚❚';
    playPauseBtn.setAttribute('aria-label', isPaused ? 'Play video' : 'Pause video');
    playPauseBtn.title = isPaused ? 'Play' : 'Pause';
}

function togglePlayback() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }

    if (videoPlayer.paused) {
        videoPlayer.play().catch((error) => {
            console.error('Error playing video:', error);
            updateStatus('Could not play video', 'error');
        });
    } else {
        videoPlayer.pause();
    }
}

function syncTimeInputs() {
    startTimeInput.value = startTime.toFixed(1);
    endTimeInput.value = endTime.toFixed(1);
}

function updateTrimSlider() {
    const startPercent = getTimePercent(startTime);
    const endPercent = getTimePercent(endTime);

    selectedRange.style.left = `${startPercent}%`;
    selectedRange.style.right = `${100 - endPercent}%`;
    startHandle.style.left = `${startPercent}%`;
    endHandle.style.left = `${endPercent}%`;
    sliderStartLabel.textContent = `Start: ${formatTime(startTime)}`;
    sliderEndLabel.textContent = `End: ${formatTime(endTime)}`;
    updatePlayheadMarker();
}

function updatePlayheadMarker() {
    playheadMarker.style.left = `${getTimePercent(videoPlayer.currentTime || 0)}%`;
}

function startPlayheadLoop() {
    stopPlayheadLoop();

    const update = () => {
        updatePlayheadMarker();

        if (!videoPlayer.paused && !videoPlayer.ended) {
            playheadAnimationFrame = requestAnimationFrame(update);
        }
    };

    update();
}

function stopPlayheadLoop() {
    if (playheadAnimationFrame !== null) {
        cancelAnimationFrame(playheadAnimationFrame);
        playheadAnimationFrame = null;
    }
}

function renderLosslessCutPoints() {
    keyframeMarkers.innerHTML = '';

    if (!videoDuration || losslessCutPoints.length === 0) {
        return;
    }

    const fragment = document.createDocumentFragment();

    losslessCutPoints.forEach((time) => {
        const marker = document.createElement('div');
        marker.className = 'keyframe-marker';
        marker.style.left = `${getTimePercent(time)}%`;
        marker.title = `Lossless cut point: ${formatTime(time)}`;
        fragment.appendChild(marker);
    });

    keyframeMarkers.appendChild(fragment);
}

function setStartTime(time, seekVideo = false) {
    startTime = clamp(time, 0, Math.max(0, endTime - MIN_TRIM_SECONDS));
    syncTimeInputs();
    updateTrimSlider();

    if (seekVideo) {
        videoPlayer.currentTime = startTime;
    }
}

function setEndTime(time, seekVideo = false) {
    endTime = clamp(time, Math.min(videoDuration, startTime + MIN_TRIM_SECONDS), videoDuration);
    syncTimeInputs();
    updateTrimSlider();

    if (seekVideo) {
        videoPlayer.currentTime = endTime;
    }
}

function updateTimeFromInput(type) {
    const input = type === 'start' ? startTimeInput : endTimeInput;
    const value = parseFloat(input.value);

    if (!Number.isFinite(value)) {
        return;
    }

    if (type === 'start') {
        setStartTime(value);
    } else {
        setEndTime(value);
    }
}

function updateActiveTrimHandle(event) {
    if (!activeTrimHandle || !videoDuration) {
        return;
    }

    const time = getSliderTime(event);

    if (activeTrimHandle === 'start') {
        setStartTime(time, true);
    } else {
        setEndTime(time, true);
    }
}

function beginTrimHandleDrag(handle, event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    event.preventDefault();
    activeTrimHandle = handle;
    updateActiveTrimHandle(event);
}

function stopTrimHandleDrag() {
    activeTrimHandle = null;
}

function seekTimeline(event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    if (event.target === startHandle || event.target === endHandle) {
        return;
    }

    videoPlayer.currentTime = getSliderTime(event);
    updatePlayheadMarker();
}

function beginTimelineScrub(event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    if (event.target === startHandle || event.target === endHandle) {
        return;
    }

    event.preventDefault();
    isScrubbingTimeline = true;
    seekTimeline(event);
}

function updateTimelineScrub(event) {
    if (!isScrubbingTimeline) {
        return;
    }

    seekTimeline(event);
    updateTimelineTooltip(event);
}

function stopTimelineScrub() {
    isScrubbingTimeline = false;
}

function seekKeyframe(direction) {
    if (!currentVideoPath || losslessCutPoints.length === 0) {
        updateStatus('No keyframes loaded for this video', 'error');
        return;
    }

    const currentTime = videoPlayer.currentTime || 0;
    const targetKeyframe = direction === 'next'
        ? losslessCutPoints.find((time) => time > currentTime + KEYFRAME_SEEK_EPSILON)
        : [...losslessCutPoints].reverse().find((time) => time < currentTime - KEYFRAME_SEEK_EPSILON);

    if (!Number.isFinite(targetKeyframe)) {
        updateStatus(`No ${direction} keyframe`, 'info');
        return;
    }

    videoPlayer.currentTime = targetKeyframe;
    updatePlayheadMarker();
}

function updateTimelineTooltip(event) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    const rect = trimSlider.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const time = (x / rect.width) * videoDuration;

    timelineTooltip.textContent = `${time.toFixed(1)}s`;
    timelineTooltip.style.left = `${x}px`;
    timelineTooltip.classList.add('visible');
}

function hideTimelineTooltip() {
    timelineTooltip.classList.remove('visible');
}

function formatFilenameTime(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join('.');
}

function getFileName(filePath) {
    return filePath.split(/[\\/]/).pop() || 'trimmed_video.mp4';
}

function buildDefaultSaveName(inputPath, start, end) {
    const fileName = getFileName(inputPath);
    const extensionIndex = fileName.lastIndexOf('.');
    const name = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '.mp4';

    if (!settings.appendCutTimes) {
        return `trimmed_${fileName}`;
    }

    return `${name} ${formatFilenameTime(start)} - ${formatFilenameTime(end)}${extension}`;
}

function loadSettings() {
    const savedAppendCutTimes = localStorage.getItem(APPEND_CUT_TIMES_SETTING);
    const savedRememberLastFolder = localStorage.getItem(REMEMBER_LAST_FOLDER_SETTING);
    const savedShowDeleteOption = localStorage.getItem(SHOW_DELETE_OPTION_SETTING);
    const savedAutoAdvance = localStorage.getItem(AUTO_ADVANCE_SETTING);

    settings.appendCutTimes = savedAppendCutTimes === null
        ? true
        : savedAppendCutTimes === 'true';
    settings.rememberLastFolder = savedRememberLastFolder === 'true';
    settings.showDeleteOption = savedShowDeleteOption === null
        ? true
        : savedShowDeleteOption === 'true';
    settings.autoAdvance = savedAutoAdvance === 'true';

    window.electronAPI.updateMenuSettings(settings);
}

function saveSettings() {
    localStorage.setItem(APPEND_CUT_TIMES_SETTING, settings.appendCutTimes.toString());
    localStorage.setItem(REMEMBER_LAST_FOLDER_SETTING, settings.rememberLastFolder.toString());
    localStorage.setItem(SHOW_DELETE_OPTION_SETTING, settings.showDeleteOption.toString());
    localStorage.setItem(AUTO_ADVANCE_SETTING, settings.autoAdvance.toString());

    if (settings.rememberLastFolder && currentFolderPath) {
        localStorage.setItem(LAST_FOLDER_SETTING, currentFolderPath);
    }

    if (!settings.rememberLastFolder) {
        localStorage.removeItem(LAST_FOLDER_SETTING);
    }
}

function setSetting(key, value, updateMenu = true) {
    settings[key] = value;
    saveSettings();
    renderLoadedVideoInfo();
    refreshFolderLibrary();

    if (updateMenu) {
        window.electronAPI.updateMenuSettings(settings);
    }
}

// Helper function to update status
function updateStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    setTimeout(() => {
        if (statusDiv.className === `status ${type}`) {
            statusDiv.className = 'status';
        }
    }, 3000);
}

async function loadLosslessCutPoints() {
    const videoPath = currentVideoPath;
    losslessCutPoints = [];
    keyframeMarkers.innerHTML = '';

    if (!videoPath) {
        return;
    }

    try {
        const videoInfo = await window.electronAPI.getVideoInfo(videoPath);

        if (videoPath !== currentVideoPath) {
            return;
        }

        if (Number.isFinite(videoInfo.duration) && videoInfo.duration > 0) {
            videoDuration = videoInfo.duration;
        }

        losslessCutPoints = videoInfo.keyframes || [];
        renderLosslessCutPoints();
        updateTrimSlider();
    } catch (error) {
        console.error('Error loading lossless cut points:', error);
        updateStatus('Video loaded, but lossless cut points could not be shown', 'error');
    }
}

function highlightSelectedFolderVideo() {
    const cards = videoGrid.querySelectorAll('.video-card');

    cards.forEach((card) => {
        card.classList.toggle('selected', card.dataset.path === currentVideoPath);
    });
}

function renderLoadedVideoInfo() {
    if (!currentVideo) {
        fileInfo.innerHTML = `
            <h3>No Video Loaded</h3>
            <p>Open a folder or select a video file to begin.</p>
        `;
        return;
    }

    fileInfo.innerHTML = `
        <h3>Loaded Video</h3>
        <p><strong>${currentVideo.name}</strong></p>
        <p>Size: ${formatBytes(currentVideo.size)}</p>
        ${settings.showDeleteOption ? `
            <div class="file-info-actions">
                <button class="btn-danger" id="deleteCurrentVideoBtn">Delete Video</button>
            </div>
        ` : ''}
    `;

    const deleteCurrentVideoBtn = document.getElementById('deleteCurrentVideoBtn');

    if (deleteCurrentVideoBtn) {
        deleteCurrentVideoBtn.addEventListener('click', () => deleteVideo(currentVideo));
    }
}

function getLibrarySearchQuery() {
    return librarySearch.value.trim().toLowerCase();
}

function filterFolderVideosBySearch(videos) {
    const query = getLibrarySearchQuery();

    if (!query) {
        return videos;
    }

    return videos.filter((video) => video.name.toLowerCase().includes(query));
}

function getSortedFolderVideos() {
    const videos = [...folderVideos];

    return videos.sort((a, b) => {
        switch (videoSortSelect.value) {
            case 'name-desc':
                return b.name.localeCompare(a.name);
            case 'duration-asc':
                return (a.duration ?? Number.POSITIVE_INFINITY) - (b.duration ?? Number.POSITIVE_INFINITY);
            case 'duration-desc':
                return (b.duration ?? Number.NEGATIVE_INFINITY) - (a.duration ?? Number.NEGATIVE_INFINITY);
            case 'size-asc':
                return a.size - b.size;
            case 'size-desc':
                return b.size - a.size;
            case 'name-asc':
            default:
                return a.name.localeCompare(b.name);
        }
    });
}

function getVisibleFolderVideos() {
    return filterFolderVideosBySearch(getSortedFolderVideos());
}

function updateFolderSummary() {
    const total = folderVideos.length;
    const visible = getVisibleFolderVideos().length;
    const query = getLibrarySearchQuery();

    if (total === 0) {
        folderSummary.textContent = currentFolderPath
            ? 'No supported videos found in this folder.'
            : 'No folder selected.';
        return;
    }

    if (currentFolderPath) {
        let summary = `${total} video${total === 1 ? '' : 's'} in ${currentFolderPath}`;

        if (query) {
            summary = `${visible} of ${total} match "${librarySearch.value.trim()}"`;
        }

        folderSummary.textContent = summary;
        return;
    }

    if (total === 1) {
        folderSummary.textContent = query
            ? `${visible} of 1 match "${librarySearch.value.trim()}"`
            : '1 selected video file';
        return;
    }

    let summary = `${total} videos`;

    if (query) {
        summary = `${visible} of ${total} match "${librarySearch.value.trim()}"`;
    }

    folderSummary.textContent = summary;
}

function refreshFolderLibrary() {
    updateFolderSummary();
    renderFolderVideos(getVisibleFolderVideos());
}

function clearLibrarySearch() {
    librarySearch.value = '';
}

async function openVideo(video) {
    currentVideo = video;
    currentVideoPath = video.path;
    videoPlayer.src = toFileUrl(currentVideoPath);
    videoPlayer.load();
    renderLoadedVideoInfo();

    updateStatus(`Loaded: ${video.name}`, 'success');
    highlightSelectedFolderVideo();

    videoPlayer.onloadedmetadata = () => {
        videoDuration = videoPlayer.duration;
        endTime = videoDuration;
        startTime = 0;
        syncTimeInputs();
        renderLosslessCutPoints();
        updateTrimSlider();
        updatePlayPauseButton();
        updateStatus(`Video loaded. Duration: ${formatTime(videoDuration)}`, 'success');
    };

    await loadLosslessCutPoints();
}

function renderFolderVideos(videos) {
    videoGrid.innerHTML = '';

    if (videos.length === 0) {
        if (folderVideos.length > 0 && getLibrarySearchQuery()) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'folder-summary';
            emptyMessage.textContent = `No videos match "${librarySearch.value.trim()}".`;
            videoGrid.appendChild(emptyMessage);
        }

        return;
    }

    const fragment = document.createDocumentFragment();

    videos.forEach((video) => {
        const card = document.createElement('div');
        const openButton = document.createElement('button');
        const thumb = video.thumbnailPath
            ? document.createElement('img')
            : document.createElement('div');
        const details = document.createElement('div');
        const title = document.createElement('div');
        const meta = document.createElement('div');
        const deleteButton = document.createElement('button');
        const duration = formatDurationTime(video.duration);

        card.className = 'video-card';
        card.dataset.path = video.path;
        openButton.type = 'button';
        openButton.className = 'video-card-main';

        if (video.thumbnailPath) {
            thumb.src = toFileUrl(video.thumbnailPath);
            thumb.alt = '';
            thumb.className = 'video-thumb';
        } else {
            thumb.className = 'video-thumb video-thumb-placeholder';
            thumb.textContent = 'Video';
        }

        title.className = 'video-card-title';
        title.textContent = video.name;
        meta.className = 'video-card-meta';
        meta.textContent = `${duration} · ${formatBytes(video.size)}`;

        details.appendChild(title);
        details.appendChild(meta);
        openButton.appendChild(thumb);
        openButton.appendChild(details);
        openButton.addEventListener('click', () => openVideo(video));
        card.appendChild(openButton);

        if (settings.showDeleteOption) {
            deleteButton.type = 'button';
            deleteButton.className = 'video-delete-button';
            deleteButton.textContent = '×';
            deleteButton.setAttribute('aria-label', `Delete ${video.name}`);
            deleteButton.title = 'Delete video';
            deleteButton.addEventListener('click', () => deleteVideo(video));
            card.appendChild(deleteButton);
        }

        fragment.appendChild(card);
    });

    videoGrid.appendChild(fragment);
    highlightSelectedFolderVideo();
}

function clearCurrentVideo() {
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    currentVideo = null;
    currentVideoPath = null;
    videoDuration = 0;
    startTime = 0;
    endTime = 0;
    losslessCutPoints = [];
    keyframeMarkers.innerHTML = '';

    syncTimeInputs();
    updateTrimSlider();
    updatePlayPauseButton();
    renderLoadedVideoInfo();
    highlightSelectedFolderVideo();
}

async function deleteVideo(video) {
    const wasCurrentVideo = video.path === currentVideoPath;

    if (wasCurrentVideo) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    try {
        const result = await window.electronAPI.deleteVideo(video.path);

        if (!result.deleted) {
            if (wasCurrentVideo) {
                await openVideo(video);
            }
            updateStatus('Delete cancelled', 'info');
            return;
        }

        folderVideos = folderVideos.filter((folderVideo) => folderVideo.path !== video.path);
        refreshFolderLibrary();

        if (wasCurrentVideo) {
            clearCurrentVideo();
        }

        updateStatus(`Moved ${video.name} to the Recycle Bin`, 'success');
    } catch (error) {
        if (wasCurrentVideo) {
            await openVideo(video);
        }
        console.error('Error deleting video:', error);
        updateStatus('Error deleting video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function loadVideo() {
    try {
        const video = await window.electronAPI.selectVideo();

        if (!video) {
            updateStatus('File selection cancelled', 'info');
            return;
        }

        currentFolderPath = null;
        folderVideos = [video];
        clearLibrarySearch();
        refreshFolderLibrary();
        await openVideo(video);
    } catch (error) {
        console.error('Error loading video:', error);
        updateStatus('Error loading video: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function loadVideoFolder(folderPath = null) {
    updateStatus('Loading folder thumbnails...', 'info');

    try {
        const result = await window.electronAPI.selectVideoFolder(folderPath);

        if (!result) {
            updateStatus('Folder selection cancelled', 'info');
            return;
        }

        await applyFolderLibraryResult(result);

        if (settings.rememberLastFolder && result.folderPath) {
            localStorage.setItem(LAST_FOLDER_SETTING, result.folderPath);
        }
    } catch (error) {
        console.error('Error loading folder:', error);
        updateStatus('Error loading folder: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function applyFolderLibraryResult(result) {
    folderVideos = result.videos || [];
    currentFolderPath = result.folderPath || null;
    clearLibrarySearch();
    refreshFolderLibrary();

    if (!currentVideoPath && folderVideos.length > 0) {
        await openVideo(getVisibleFolderVideos()[0] || folderVideos[0]);
    }
}

async function loadDroppedItems(paths) {
    if (!paths.length) {
        return;
    }

    updateStatus('Loading dropped items...', 'info');

    try {
        const result = await window.electronAPI.handleDroppedPaths(paths);

        if (!result?.videos?.length) {
            updateStatus('No supported videos in drop', 'error');
            return;
        }

        await applyFolderLibraryResult(result);

        if (settings.rememberLastFolder && result.folderPath) {
            localStorage.setItem(LAST_FOLDER_SETTING, result.folderPath);
        }

        const count = result.videos.length;
        updateStatus(`Loaded ${count} video${count === 1 ? '' : 's'} from drop`, 'success');
    } catch (error) {
        console.error('Error loading dropped items:', error);
        updateStatus('Error loading dropped items: ' + (error.message || 'Unknown error'), 'error');
    }
}

function getDroppedPaths(event) {
    return [...event.dataTransfer.files]
        .map((file) => file.path)
        .filter((filePath) => typeof filePath === 'string' && filePath.length > 0);
}

function setupDragAndDrop() {
    let dragActive = false;

    window.addEventListener('dragenter', (event) => {
        event.preventDefault();

        if (!dragActive) {
            dragActive = true;
            libraryPanel.classList.add('drag-over');
        }
    });

    window.addEventListener('dragover', (event) => {
        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
    });

    window.addEventListener('dragleave', (event) => {
        if (
            event.clientX <= 0
            || event.clientY <= 0
            || event.clientX >= window.innerWidth
            || event.clientY >= window.innerHeight
        ) {
            dragActive = false;
            libraryPanel.classList.remove('drag-over');
        }
    });

    window.addEventListener('drop', async (event) => {
        event.preventDefault();
        dragActive = false;
        libraryPanel.classList.remove('drag-over');
        await loadDroppedItems(getDroppedPaths(event));
    });
}

async function restoreLastFolder() {
    const lastFolder = localStorage.getItem(LAST_FOLDER_SETTING);

    if (settings.rememberLastFolder && lastFolder) {
        await loadVideoFolder(lastFolder);
    }
}

// Set start time
function setStart() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    setStartTime(videoPlayer.currentTime);
    updateStatus(`Start time set to ${formatTime(startTime)}`, 'success');
}

// Set end time
function setEnd() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    setEndTime(videoPlayer.currentTime);
    updateStatus(`End time set to ${formatTime(endTime)}`, 'success');
}

// Reset times
function resetTimes() {
    startTime = 0;
    endTime = videoDuration;
    syncTimeInputs();
    updateTrimSlider();
    videoPlayer.currentTime = 0;
    updateStatus('Times reset', 'info');
}

function seekBySeconds(delta) {
    if (!currentVideoPath || !videoDuration) {
        return;
    }

    videoPlayer.currentTime = clamp(videoPlayer.currentTime + delta, 0, videoDuration);
    updatePlayheadMarker();
}

function runShortcutAction(action) {
    switch (action) {
        case 'open-file':
            loadVideo();
            break;
        case 'open-folder':
            loadVideoFolder();
            break;
        case 'trim':
            trimVideo();
            break;
        case 'play-pause':
            togglePlayback();
            break;
        case 'set-start':
            setStart();
            break;
        case 'set-end':
            setEnd();
            break;
        case 'reset':
            resetTimes();
            break;
        case 'prev-keyframe':
            seekKeyframe('previous');
            break;
        case 'next-keyframe':
            seekKeyframe('next');
            break;
        case 'seek-back':
            seekBySeconds(-1);
            break;
        case 'seek-forward':
            seekBySeconds(1);
            break;
        default:
            break;
    }
}

function isEditableTarget(target) {
    if (!target) {
        return false;
    }

    const tag = target.tagName;

    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function handlePlaybackShortcut(event) {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }

    if (event.shiftKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        runShortcutAction('seek-back');
        return;
    }

    if (event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        runShortcutAction('seek-forward');
        return;
    }

    if (event.shiftKey) {
        return;
    }

    switch (event.key) {
        case ' ':
            event.preventDefault();
            runShortcutAction('play-pause');
            break;
        case 'i':
        case 'I':
            runShortcutAction('set-start');
            break;
        case 'o':
        case 'O':
            runShortcutAction('set-end');
            break;
        case 'r':
        case 'R':
            runShortcutAction('reset');
            break;
        case ',':
            runShortcutAction('prev-keyframe');
            break;
        case '.':
            runShortcutAction('next-keyframe');
            break;
        default:
            break;
    }
}

async function advanceToNextVideo() {
    const videos = getVisibleFolderVideos();
    const currentIndex = videos.findIndex((video) => video.path === currentVideoPath);

    if (currentIndex === -1 || currentIndex >= videos.length - 1) {
        return false;
    }

    await openVideo(videos[currentIndex + 1]);
    return true;
}

// Trim video
async function trimVideo() {
    if (!currentVideoPath) {
        updateStatus('Please load a video first', 'error');
        return;
    }
    
    startTime = parseFloat(startTimeInput.value);
    endTime = parseFloat(endTimeInput.value);
    
    if (startTime >= endTime) {
        updateStatus('Start time must be less than end time', 'error');
        return;
    }
    
    if (endTime > videoDuration) {
        updateStatus('End time cannot exceed video duration', 'error');
        return;
    }
    
    // Ask where to save
    const savePath = await window.electronAPI.saveDialog({
        defaultPath: buildDefaultSaveName(currentVideoPath, startTime, endTime)
    });
    if (!savePath) {
        updateStatus('Save cancelled', 'info');
        return;
    }
    
    updateStatus('Trimming video... This may take a moment', 'info');
    
    try {
        const result = await window.electronAPI.trimVideo({
            inputPath: currentVideoPath,
            startTime: startTime,
            endTime: endTime,
            outputPath: savePath
        });
        
        if (result.success) {
            const wasExpanded = result.actualStartTime < startTime || result.actualEndTime > endTime;
            const trimDetails = wasExpanded
                ? ` Lossless range: ${formatTime(result.actualStartTime)} to ${formatTime(result.actualEndTime)}.`
                : '';

            const successMessage = `Success. Video saved to ${savePath} (${(result.size / (1024 * 1024)).toFixed(2)} MB).${trimDetails}`;

            if (settings.autoAdvance) {
                const advanced = await advanceToNextVideo();

                if (advanced) {
                    updateStatus(`${successMessage} Loaded next clip: ${currentVideo.name}.`, 'success');
                    return;
                }
            }

            updateStatus(successMessage, 'success');
        }
    } catch (error) {
        console.error('Error trimming video:', error);
        updateStatus('Error trimming video: ' + (error.error || error.message || 'Unknown error'), 'error');
    }
}

// Event listeners
selectVideoBtn.addEventListener('click', loadVideo);
selectFolderBtn.addEventListener('click', () => loadVideoFolder());
librarySearch.addEventListener('input', refreshFolderLibrary);
videoSortSelect.addEventListener('change', refreshFolderLibrary);
playPauseBtn.addEventListener('click', togglePlayback);
videoPlayer.addEventListener('click', togglePlayback);
prevKeyframeBtn.addEventListener('click', () => seekKeyframe('previous'));
nextKeyframeBtn.addEventListener('click', () => seekKeyframe('next'));
setStartBtn.addEventListener('click', setStart);
setEndBtn.addEventListener('click', setEnd);
resetBtn.addEventListener('click', resetTimes);
trimBtn.addEventListener('click', trimVideo);
window.electronAPI.onMenuSettingChanged(({ key, value }) => setSetting(key, value, false));
window.electronAPI.onShortcut(runShortcutAction);
document.addEventListener('keydown', handlePlaybackShortcut);
startTimeInput.addEventListener('change', () => updateTimeFromInput('start'));
endTimeInput.addEventListener('change', () => updateTimeFromInput('end'));
trimSlider.addEventListener('pointerdown', beginTimelineScrub);
trimSlider.addEventListener('pointermove', updateTimelineTooltip);
trimSlider.addEventListener('pointerleave', hideTimelineTooltip);
startHandle.addEventListener('pointerdown', (event) => beginTrimHandleDrag('start', event));
endHandle.addEventListener('pointerdown', (event) => beginTrimHandleDrag('end', event));
document.addEventListener('pointermove', updateActiveTrimHandle);
document.addEventListener('pointermove', updateTimelineScrub);
document.addEventListener('pointerup', stopTrimHandleDrag);
document.addEventListener('pointerup', stopTimelineScrub);
videoPlayer.addEventListener('play', updatePlayPauseButton);
videoPlayer.addEventListener('play', startPlayheadLoop);
videoPlayer.addEventListener('pause', updatePlayPauseButton);
videoPlayer.addEventListener('pause', stopPlayheadLoop);
videoPlayer.addEventListener('ended', updatePlayPauseButton);
videoPlayer.addEventListener('ended', stopPlayheadLoop);
videoPlayer.addEventListener('seeked', updatePlayheadMarker);

// Update time inputs when video time changes
videoPlayer.addEventListener('timeupdate', () => {
    if (videoPlayer.currentTime < startTime - 0.05) {
        videoPlayer.currentTime = startTime;
    }

    if (videoPlayer.paused) {
        updatePlayheadMarker();
    }
});

// Initialize
loadSettings();
setupDragAndDrop();
restoreLastFolder();
console.log('Video Trimmer Pro loaded');