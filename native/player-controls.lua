-- Controls are drawn in mpv's OSD plane, without resizing the video surface.
local mp = require 'mp'
local assdraw = require 'mp.assdraw'
local enabled, visible = false, false
local last_activity, dragging, seek_preview = 0, nil, nil
local seek_deadline = 0
local overlay = mp.create_osd_overlay('ass-events')
local geometry = {}
local last_draw = ''
local bindings = {}

local function clamp(value, low, high) return math.max(low, math.min(high, value)) end
local function number(name, fallback) return mp.get_property_number(name, fallback or 0) end
local function duration() return number('duration') end
local function time(value)
    value = math.max(0, math.floor(value or 0))
    local hours, minutes, seconds = math.floor(value / 3600), math.floor(value / 60) % 60, value % 60
    return hours > 0 and string.format('%d:%02d:%02d', hours, minutes, seconds) or string.format('%02d:%02d', minutes, seconds)
end
local function wake()
    visible = true
    last_activity = mp.get_time()
end
local function layout()
    local w, h = mp.get_osd_size()
    if not w or w <= 0 or not h or h <= 0 then return nil end
    local s = clamp(h / 900, 0.8, 1.7)
    geometry = {w=w, h=h, s=s, left=24*s, right=w-24*s, seek_y=h-64*s, row=h-29*s,
        play=38*s, mute=83*s, volume_left=108*s, volume_right=195*s, full=w-36*s, cover=w-102*s, speed=w-170*s}
    return geometry
end
local function text(a, x, y, value, size, alignment, color)
    a:new_event()
    a:append(string.format('{\\an%d\\pos(%.2f,%.2f)\\fnSegoe UI\\fs%.2f\\bord0\\shad0\\1c&H%s&}', alignment or 5, x, y, size, color or 'FFFFFF'))
    a:append(value)
end
local function shape(a, color, alpha, draw)
    a:new_event()
    a:append(string.format('{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H%s&\\1a&H%02X&}', color or 'FFFFFF', alpha or 0))
    a:draw_start(); draw(a); a:draw_stop()
end
local function rect(a, x1, y1, x2, y2, color, alpha)
    shape(a, color, alpha, function(p) p:rect_cw(x1,y1,x2,y2) end)
end
local function circle(a, x, y, radius)
    shape(a, 'FFFFFF', 0, function(p)
        p:move_to(x+radius,y)
        for i=1,24 do local angle=i*math.pi/12; p:line_to(x+radius*math.cos(angle),y+radius*math.sin(angle)) end
    end)
end
local function hit(x,y,g)
    if x>=g.left-6*g.s and x<=g.right+6*g.s and math.abs(y-g.seek_y)<=13*g.s then return 'seek' end
    if math.abs(y-g.row)>20*g.s then return nil end
    if math.abs(x-g.play)<20*g.s then return 'play' end
    if math.abs(x-g.mute)<20*g.s then return 'mute' end
    if x>=g.volume_left-4*g.s and x<=g.volume_right+6*g.s then return 'volume' end
    if math.abs(x-g.full)<22*g.s then return 'full' end
    if math.abs(x-g.cover)<32*g.s then return 'cover' end
    if math.abs(x-g.speed)<28*g.s then return 'speed' end
end
local labels={play='播放 / 暂停',mute='静音 / 恢复音量',volume='音量',full='退出全屏',cover='设为封面',speed='播放速度'}
local function render()
    if not enabled or not visible then overlay:remove(); last_draw=''; return end
    local g=layout(); if not g then return end
    local a=assdraw.ass_new()
    local s,w,h=g.s,g.w,g.h
    -- A translucent gradient, rather than an opaque bar or extra layout space.
    for i=0,19 do rect(a,0,h-(140-i*7)*s,w,h-(133-i*7)*s,'000000',math.floor(250-i*8)) end
    local total=duration()
    local position=seek_preview or number('time-pos')
    local progress=total>0 and clamp(position/total,0,1) or 0
    rect(a,g.left,g.seek_y-2*s,g.right,g.seek_y+2*s,'FFFFFF',170)
    rect(a,g.left,g.seek_y-2*s,g.left+(g.right-g.left)*progress,g.seek_y+2*s)
    circle(a,g.left+(g.right-g.left)*progress,g.seek_y,5*s)
    if mp.get_property_bool('pause',false) then
        shape(a,'FFFFFF',0,function(p) p:move_to(g.play-5*s,g.row-8*s);p:line_to(g.play+8*s,g.row);p:line_to(g.play-5*s,g.row+8*s) end)
    else
        rect(a,g.play-6*s,g.row-8*s,g.play-2*s,g.row+8*s)
        rect(a,g.play+2*s,g.row-8*s,g.play+6*s,g.row+8*s)
    end
    shape(a,'FFFFFF',0,function(p)
        p:move_to(g.mute-9*s,g.row-4*s);p:line_to(g.mute-4*s,g.row-4*s);p:line_to(g.mute+2*s,g.row-9*s)
        p:line_to(g.mute+2*s,g.row+9*s);p:line_to(g.mute-4*s,g.row+4*s);p:line_to(g.mute-9*s,g.row+4*s)
    end)
    local muted=mp.get_property_bool('mute',false)
    text(a,g.mute+8*s,g.row,muted and '×' or ')',18*s)
    local volume=muted and 0 or clamp(number('volume',100),0,100)
    rect(a,g.volume_left,g.row-2*s,g.volume_right,g.row+2*s,'FFFFFF',170)
    rect(a,g.volume_left,g.row-2*s,g.volume_left+(g.volume_right-g.volume_left)*volume/100,g.row+2*s)
    circle(a,g.volume_left+(g.volume_right-g.volume_left)*volume/100,g.row,4*s)
    text(a,214*s,g.row,time(position)..' / '..time(total),15*s,4)
    text(a,g.speed,g.row,string.format('%g×',number('speed',1)),16*s)
    text(a,g.cover,g.row,'封面',15*s)
    for _,sign in ipairs({-1,1}) do
        rect(a,g.full+sign*8*s-(sign>0 and 5*s or 0),g.row-8*s,g.full+sign*8*s+(sign<0 and 5*s or 0),g.row-6*s)
        rect(a,g.full+sign*8*s-(sign>0 and 5*s or 0),g.row+6*s,g.full+sign*8*s+(sign<0 and 5*s or 0),g.row+8*s)
        rect(a,g.full+sign*7*s-s,g.row-8*s,g.full+sign*7*s+s,g.row-3*s)
        rect(a,g.full+sign*7*s-s,g.row+3*s,g.full+sign*7*s+s,g.row+8*s)
    end
    local mx,my=mp.get_mouse_pos()
    local hovered=hit(mx,my,g)
    if hovered=='seek' then text(a,clamp(mx,70*s,w-70*s),g.seek_y-22*s,time(total*clamp((mx-g.left)/(g.right-g.left),0,1)),14*s)
    elseif hovered then text(a,clamp(mx,70*s,w-70*s),g.seek_y-22*s,hovered=='volume' and ('音量 '..math.floor(volume)..'%') or labels[hovered],14*s) end
    if a.text~=last_draw or overlay.res_x~=w or overlay.res_y~=h then
        overlay.res_x=w;overlay.res_y=h;overlay.data=a.text;overlay:update();last_draw=a.text
    end
end
local function adjust(kind,x,g)
    if kind=='seek' then seek_preview=duration()*clamp((x-g.left)/(g.right-g.left),0,1)
    elseif kind=='volume' then
        mp.set_property_bool('mute',false)
        mp.set_property_number('volume',100*clamp((x-g.volume_left)/(g.volume_right-g.volume_left),0,1))
    end
end
local function mouse_move()
    if not enabled then return end
    wake();local g=layout();if not g then return end
    local x=mp.get_mouse_pos();if dragging then adjust(dragging,x,g) end
    render()
end
local function click(event)
    if not enabled then return end
    local was_visible=visible;wake();local g=layout();if not g then return end
    local x,y=mp.get_mouse_pos()
    if event.event=='down' then
        dragging=was_visible and hit(x,y,g) or nil
        if dragging=='seek' or dragging=='volume' then adjust(dragging,x,g) end
    elseif event.event=='up' then
        local action=dragging;dragging=nil
        if action=='seek' then
            adjust('seek',x,g);seek_deadline=mp.get_time()+3;mp.commandv('seek',seek_preview,'absolute+exact')
        elseif action=='volume' then adjust('volume',x,g)
        elseif action and hit(x,y,g)==action then
            if action=='play' then mp.commandv('cycle','pause')
            elseif action=='mute' then mp.commandv('cycle','mute')
            elseif action=='full' then mp.commandv('script-message','vm-exit-fullscreen')
            elseif action=='cover' then mp.commandv('script-message','vm-cover')
            elseif action=='speed' then mp.commandv('cycle-values','speed','1','1.25','1.5','2','0.5','0.75') end
        end
    end
    render()
end
local function bind(key,name,fn,opts)
    local id='vm-controls-'..name;bindings[#bindings+1]=id
    mp.add_forced_key_binding(key,id,fn,opts)
end
local function mode(value)
    enabled=value=='yes';dragging=nil;seek_preview=nil
    for _,name in ipairs(bindings) do mp.remove_key_binding(name) end
    bindings={}
    if enabled then
        bind('MOUSE_MOVE','move',mouse_move)
        bind('MOUSE_LEAVE','leave',function() if not dragging then visible=false;render() end end)
        bind('MBTN_LEFT','click',click,{complex=true})
        bind('MBTN_LEFT_DBL','double',function() mp.commandv('script-message','vm-exit-fullscreen') end)
        bind('SPACE','pause',function() wake();mp.commandv('cycle','pause') end)
        bind('ESC','exit',function() mp.commandv('script-message','vm-exit-fullscreen') end)
        bind('f','fullscreen',function() mp.commandv('script-message','vm-exit-fullscreen') end)
        bind('LEFT','back',function() wake();mp.commandv('seek',-5,'relative+exact') end,{repeatable=true})
        bind('RIGHT','forward',function() wake();mp.commandv('seek',5,'relative+exact') end,{repeatable=true})
        bind('WHEEL_UP','volume-up',function() wake();mp.set_property_number('volume',clamp(number('volume')+5,0,100)) end)
        bind('WHEEL_DOWN','volume-down',function() wake();mp.set_property_number('volume',clamp(number('volume')-5,0,100)) end)
        wake()
    else visible=false end
    mp.set_property_bool('user-data/vm-controls/enabled',enabled)
    render()
end
mp.register_script_message('vm-controls',mode)
mp.register_event('playback-restart',function() if not dragging then seek_preview=nil end end)
mp.register_event('shutdown',function() overlay:remove() end)
mp.add_periodic_timer(0.05,function()
    if not enabled then return end
    if seek_preview and not dragging and mp.get_time()>seek_deadline then seek_preview=nil end
    if visible and not dragging and mp.get_time()-last_activity>=2 then visible=false end
    render()
end)
mp.set_property_bool('user-data/vm-controls/enabled',false)
